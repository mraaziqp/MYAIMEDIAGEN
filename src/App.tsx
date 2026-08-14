import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle2, XCircle, Radio } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { VramGauge } from './components/VramGauge';
import { GeneratorPanel } from './components/GeneratorPanel';
import { ProgressViewer } from './components/ProgressViewer';
import { MediaGallery } from './components/MediaGallery';
import { ToolSchemaInspector } from './components/ToolSchemaInspector';
import { WorkerStatus } from './components/WorkerStatus';
import { WorkflowInspector } from './components/WorkflowInspector';
import { SystemStats, CloudJob, WorkflowParams, StreamProgressEvent, DurationStat } from './types';

type Tab = 'generate' | 'gallery' | 'tools' | 'workflows' | 'settings';

const ACTIVE_JOB_STORAGE_KEY = 'activePromptId';

function readStoredActiveJobId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('generate');

  // Real GPU/host telemetry sourced from the worker's last heartbeat (see api/system-stats.ts)
  // - null means no reading has succeeded yet, never a mocked value.
  const [stats, setStats] = useState<SystemStats | null>(null);

  const [jobs, setJobs] = useState<CloudJob[]>([]);

  // Persisted so a page refresh (or opening the dashboard from a different device) resumes
  // polling the same job instead of losing track of it - there's no local server session to
  // "reattach" to anymore, this is the cloud-hosted equivalent of that idea.
  const [activePromptId, setActivePromptIdState] = useState<string | null>(readStoredActiveJobId);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(() => !!readStoredActiveJobId());
  const [isFreeingVram, setIsFreeingVram] = useState(false);

  const setActivePromptId = useCallback((id: string | null) => {
    setActivePromptIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, id);
      else localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    } catch {
      // Best-effort - worst case a refresh just loses the reattach, not a functional break.
    }
  }, []);

  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);

  // Each toast used to schedule a bare setTimeout with no handle kept. Two consequences, both
  // real: the timers were never cleared on unmount, and a second toast within the window
  // inherited the FIRST toast's timer - so the new message vanished early, after the remainder
  // of the old one's 4.5s rather than its own. Tracking the handle fixes both.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/system-stats');
      const data = await res.json();
      if (res.ok) {
        setStats(data as SystemStats);
      } else {
        setStats(null);
      }
    } catch {
      setStats(null);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs?limit=100');
      if (res.ok) {
        const data = await res.json();
        if (data?.records) setJobs(data.records);
      }
    } catch (err) {
      console.warn('Failed to fetch jobs:', err);
    }
  }, []);

  // Real average render duration per model, from actually-completed jobs (see
  // getDurationStats in db/store.pg.ts) - drives the GeneratorPanel's timing badges instead
  // of guessed numbers. Refetched after every generation completes.
  const [durationStats, setDurationStats] = useState<DurationStat[]>([]);
  const fetchDurationStats = useCallback(async () => {
    try {
      const res = await fetch('/api/duration-stats');
      if (res.ok) {
        const data = await res.json();
        if (data?.stats) setDurationStats(data.stats);
      }
    } catch (err) {
      console.warn('Failed to fetch duration stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
    fetchJobs();
    fetchDurationStats();
  }, [fetchTelemetry, fetchJobs, fetchDurationStats]);

  // Poll worker telemetry faster while a job is actually running (real-time GPU movement
  // matters most exactly then) and back off to a slower idle cadence otherwise.
  useEffect(() => {
    const intervalMs = isSubmitting || activePromptId ? 2000 : 6000;
    const interval = setInterval(fetchTelemetry, intervalMs);
    return () => clearInterval(interval);
  }, [fetchTelemetry, isSubmitting, activePromptId]);

  const handleFreeVram = useCallback(async () => {
    if (isFreeingVram) return;
    setIsFreeingVram(true);
    try {
      const res = await fetch('/api/free-vram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.details || 'Failed to free VRAM');
      }
      showToast('info', 'Purge signal sent - worker is unloading models & clearing GPU cache...');
      // Rapid telemetry polling to reflect the worker's memory release immediately
      setTimeout(fetchTelemetry, 600);
      setTimeout(fetchTelemetry, 1600);
      setTimeout(fetchTelemetry, 3000);
      setTimeout(fetchTelemetry, 5500);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to purge VRAM');
    } finally {
      setTimeout(() => setIsFreeingVram(false), 2000);
    }
  }, [isFreeingVram, showToast, fetchTelemetry]);

  const handleGenerate = async (params: WorkflowParams) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: params.prompt,
          mediaType: params.mediaType,
          aspectRatio: params.aspectRatio,
          seed: params.seed,
          steps: params.steps,
          cfg: params.cfg,
          referenceImage: params.referenceImage,
          referenceImageWidth: params.referenceImageWidth,
          referenceImageHeight: params.referenceImageHeight,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation trigger failed');

      setActivePromptId(data.jobId);
      showToast('info', `Queued ${params.mediaType} render - your PC will pick it up shortly...`);
      fetchJobs();
    } catch (err: any) {
      showToast('error', err?.message || 'Generation submission failed');
      setIsSubmitting(false);
    }
  };

  const handleInterrupt = async () => {
    if (!activePromptId) return;
    try {
      const res = await fetch(`/api/jobs/${activePromptId}/interrupt`, { method: 'POST' });
      if (res.ok) {
        showToast('info', 'Interrupt requested - the worker will stop the GPU job on its next check-in.');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast('error', data?.error || 'Failed to send interrupt signal.');
      }
    } catch (err) {
      showToast('error', 'Failed to send interrupt signal.');
    }
  };

  // Fires once for any terminal state (completed/failed/interrupted). Deliberately does NOT
  // clear activePromptId - the progress card stays mounted showing its final state until the
  // user explicitly dismisses it via handleDismissProgress/handleViewGallery, or starts a
  // new render.
  const handleGenerationTerminal = useCallback(
    (event: StreamProgressEvent) => {
      setIsSubmitting(false);
      if (event.status === 'completed') {
        showToast('success', 'Media render finished & vaulted!');
      } else if (event.status === 'failed') {
        showToast('error', event.error || 'GPU execution failed.');
      } else if (event.status === 'interrupted') {
        showToast('info', 'GPU job halted.');
      }
      fetchJobs();
      fetchTelemetry();
      if (event.status === 'completed') fetchDurationStats();
    },
    [showToast, fetchJobs, fetchTelemetry, fetchDurationStats]
  );

  const handleDismissProgress = useCallback(() => {
    setActivePromptId(null);
  }, [setActivePromptId]);

  const handleViewGallery = useCallback(() => {
    setActivePromptId(null);
    setActiveTab('gallery');
  }, [setActivePromptId]);

  const handleFunctionCallTriggered = () => {
    fetchTelemetry();
    setTimeout(fetchJobs, 1500);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950">
      <Navbar
        activeTab={activeTab}
        setActiveTab={(t) => setActiveTab(t as Tab)}
        systemStats={stats}
        onRefreshStats={fetchTelemetry}
        onFreeVram={handleFreeVram}
        isFreeingVram={isFreeingVram}
      />

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
            <VramGauge
              stats={stats}
              onRefresh={fetchTelemetry}
              onFreeVram={handleFreeVram}
              isFreeingVram={isFreeingVram}
            />

            {activePromptId && (
              <ProgressViewer
                promptId={activePromptId}
                onTerminal={handleGenerationTerminal}
                onInterrupt={handleInterrupt}
                onViewGallery={handleViewGallery}
                onDismiss={handleDismissProgress}
              />
            )}

            <GeneratorPanel
              onGenerate={handleGenerate}
              isGenerating={isSubmitting}
              stats={stats}
              durationStats={durationStats}
              onFreeVram={handleFreeVram}
              isFreeingVram={isFreeingVram}
            />
          </div>
        )}

        {activeTab === 'gallery' && <MediaGallery records={jobs} onRefresh={fetchJobs} />}

        {activeTab === 'tools' && <ToolSchemaInspector onTriggerFunctionCall={handleFunctionCallTriggered} />}

        {activeTab === 'workflows' && <WorkflowInspector />}

        {activeTab === 'settings' && (
          <WorkerStatus
            stats={stats}
            onRefresh={fetchTelemetry}
            onFreeVram={handleFreeVram}
            isFreeingVram={isFreeingVram}
          />
        )}
      </main>
    </div>
  );
}
