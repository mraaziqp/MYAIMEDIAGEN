import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Radio } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { VramGauge } from './components/VramGauge';
import { GeneratorPanel } from './components/GeneratorPanel';
import { ProgressViewer } from './components/ProgressViewer';
import { MediaGallery } from './components/MediaGallery';
import { ToolSchemaInspector } from './components/ToolSchemaInspector';
import { TunnelSettings } from './components/TunnelSettings';
import { WorkflowInspector } from './components/WorkflowInspector';
import { SystemStats, GenerationRecord, GatewaySettings, WorkflowParams } from './types';

const DEFAULT_AUTH_TOKEN = 'sec_rtx3060ti_gateway_key_9988';

type Tab = 'generate' | 'gallery' | 'tools' | 'workflows' | 'settings';

interface SettingsResponse {
  comfyUrl: string;
  autoOomCheck?: boolean;
  vramThresholdMb: number;
  maskedAuthToken: string;
  authTokenHash: string;
  maskedEncryptionSecret: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('generate');

  // Real GPU/host telemetry - null means no reading has succeeded yet, never a mocked value.
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);

  const [settingsResponse, setSettingsResponse] = useState<SettingsResponse | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isFreeingVram, setIsFreeingVram] = useState(false);
  // The raw bearer token is never sent back by the server (only masked). This tracks the
  // token this browser session actually knows, starting from the compiled-in default and
  // updated the moment the user successfully saves a new one via the Settings tab.
  const [authToken, setAuthToken] = useState(DEFAULT_AUTH_TOKEN);

  const [generations, setGenerations] = useState<GenerationRecord[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const fetchTelemetry = useCallback(async () => {
    setIsRefreshingStats(true);
    try {
      const res = await fetch('/api/system-stats');
      const data = await res.json();
      if (res.ok) {
        setStats(data as SystemStats);
      } else {
        setStats(null);
        showToast('error', data?.details || data?.error || `GPU telemetry unavailable (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setStats(null);
      showToast('error', err?.message || 'Failed to reach the gateway for GPU telemetry.');
    } finally {
      setIsRefreshingStats(false);
    }
  }, [showToast]);

  const fetchGenerations = useCallback(async () => {
    try {
      const res = await fetch('/api/generations?limit=100');
      if (res.ok) {
        const data = await res.json();
        if (data?.records) setGenerations(data.records);
      }
    } catch (err) {
      console.warn('Failed to fetch generations:', err);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data: SettingsResponse = await res.json();
        setSettingsResponse(data);
      }
    } catch (err) {
      console.warn('Failed to fetch settings:', err);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
    fetchGenerations();
    fetchSettings();
    const interval = setInterval(fetchTelemetry, 6000);
    return () => clearInterval(interval);
  }, [fetchTelemetry, fetchGenerations, fetchSettings]);

  const handleGenerate = async (params: WorkflowParams) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          prompt: params.prompt,
          mediaType: params.mediaType,
          modelType: params.mediaType,
          aspectRatio: params.aspectRatio,
          seed: params.seed,
          steps: params.steps,
          cfg: params.cfg,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation trigger failed');

      setActivePromptId(data.promptId);
      showToast('info', `Queued ${params.mediaType} render on the RTX 3060 Ti...`);
      fetchGenerations();
    } catch (err: any) {
      showToast('error', err?.message || 'Generation submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInterrupt = async () => {
    try {
      const res = await fetch('/api/interrupt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        showToast('info', 'GPU interrupt command dispatched.');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast('error', data?.error || 'Failed to send interrupt signal.');
      }
    } catch (err) {
      showToast('error', 'Failed to send interrupt signal.');
    } finally {
      setActivePromptId(null);
      setIsSubmitting(false);
      fetchTelemetry();
      fetchGenerations();
    }
  };

  const handleProgressCompleted = () => {
    setActivePromptId(null);
    setIsSubmitting(false);
    showToast('success', 'Media render finished & vaulted!');
    fetchGenerations();
    fetchTelemetry();
  };

  const handleUpdateSettings = async (newSettings: Partial<GatewaySettings>) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(newSettings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update settings');

      if (newSettings.authToken && newSettings.authToken.trim() !== '') {
        setAuthToken(newSettings.authToken);
      }
      showToast('success', 'Gateway settings saved.');
      fetchSettings();
      fetchTelemetry();
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to save settings');
      throw err;
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    try {
      const res = await fetch('/api/system-stats');
      const data = await res.json();
      if (res.ok) {
        setStats(data as SystemStats);
        showToast(
          data.status === 'ONLINE' ? 'success' : 'error',
          data.status === 'ONLINE'
            ? `ComfyUI reachable at ${data.comfyUrl} - ${data.vramFreeMb} MB VRAM free.`
            : `GPU telemetry read OK, but ComfyUI is not reachable at ${data.comfyUrl}.`
        );
      } else {
        setStats(null);
        showToast('error', data?.details || data?.error || 'GPU telemetry unavailable.');
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Connection test failed.');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleFreeVram = async () => {
    setIsFreeingVram(true);
    try {
      const res = await fetch('/api/free-vram', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to free VRAM');
      setStats(data.stats as SystemStats);
      showToast('success', `VRAM freed - ${data.stats.vramFreeMb} MB now available.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to free VRAM');
    } finally {
      setIsFreeingVram(false);
    }
  };

  const handleFunctionCallTriggered = () => {
    fetchTelemetry();
    setTimeout(fetchGenerations, 1500);
  };

  const gatewaySettings: GatewaySettings = {
    comfyUrl: settingsResponse?.comfyUrl || '',
    authToken: '',
    encryptionSecret: '',
    autoOomCheck: settingsResponse?.autoOomCheck ?? true,
    vramThresholdMb: settingsResponse?.vramThresholdMb ?? 2000,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950">
      <Navbar activeTab={activeTab} setActiveTab={(t) => setActiveTab(t as Tab)} systemStats={stats} onRefreshStats={fetchTelemetry} />

      {toast && (
        <div className="fixed bottom-5 right-5 z-50">
          <div
            className={`px-4 py-3 rounded-xl shadow-2xl border text-xs font-semibold flex items-center space-x-2.5 ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
                : toast.type === 'error'
                ? 'bg-rose-950/90 text-rose-300 border-rose-500/50'
                : 'bg-cyan-950/90 text-cyan-300 border-cyan-500/50'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {toast.type === 'error' && <XCircle className="w-4 h-4 text-rose-400" />}
            {toast.type === 'info' && <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 pb-16">
        {activeTab === 'generate' && (
          <div className="space-y-6">
            <VramGauge stats={stats} onRefresh={fetchTelemetry} onFreeVram={handleFreeVram} isFreeingVram={isFreeingVram} />

            {activePromptId && (
              <ProgressViewer promptId={activePromptId} onCompleted={handleProgressCompleted} onInterrupt={handleInterrupt} />
            )}

            <GeneratorPanel onGenerate={handleGenerate} isGenerating={isSubmitting} stats={stats} />
          </div>
        )}

        {activeTab === 'gallery' && <MediaGallery records={generations} onRefresh={fetchGenerations} />}

        {activeTab === 'tools' && <ToolSchemaInspector onTriggerFunctionCall={handleFunctionCallTriggered} />}

        {activeTab === 'workflows' && <WorkflowInspector />}

        {activeTab === 'settings' && (
          <TunnelSettings
            settings={gatewaySettings}
            maskedAuthToken={settingsResponse?.maskedAuthToken}
            maskedEncryptionSecret={settingsResponse?.maskedEncryptionSecret}
            onUpdateSettings={handleUpdateSettings}
            onTestConnection={handleTestConnection}
            isTestingConnection={isTestingConnection}
          />
        )}
      </main>
    </div>
  );
}
