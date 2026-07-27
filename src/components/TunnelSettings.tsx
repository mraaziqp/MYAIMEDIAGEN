import React, { useState } from 'react';
import { Sliders, Radio, Key, Lock, Check, Copy, RefreshCw, Terminal, ShieldAlert } from 'lucide-react';
import { GatewaySettings } from '../types';

interface TunnelSettingsProps {
  settings: GatewaySettings;
  maskedAuthToken?: string;
  maskedEncryptionSecret?: string;
  onUpdateSettings: (newSettings: Partial<GatewaySettings>) => Promise<void>;
  onTestConnection: () => void;
  isTestingConnection: boolean;
}

export const TunnelSettings: React.FC<TunnelSettingsProps> = ({
  settings,
  maskedAuthToken,
  maskedEncryptionSecret,
  onUpdateSettings,
  onTestConnection,
  isTestingConnection,
}) => {
  const [comfyUrl, setComfyUrl] = useState(settings.comfyUrl);
  // Real secrets are never sent back from the server (only masked previews) - these start
  // blank; leaving them blank on save keeps the existing value, matching POST /api/settings.
  const [authToken, setAuthToken] = useState('');
  const [encryptionSecret, setEncryptionSecret] = useState('');
  const [autoOomCheck, setAutoOomCheck] = useState(settings.autoOomCheck);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  // Cloudflare Tunnel CLI script builder
  const cliScript = `cloudflared tunnel --url http://127.0.0.1:8188`;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateSettings({
      comfyUrl,
      authToken,
      encryptionSecret,
      autoOomCheck,
    });
    setAuthToken('');
    setEncryptionSecret('');
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleCopyCli = () => {
    navigator.clipboard.writeText(cliScript);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <div className="space-y-6 text-slate-100">
      
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">Cloudflare Tunnel & ComfyUI Gateway Settings</h2>
            <p className="text-xs text-slate-400">Configure connection params, Bearer authentication, and AES-256 vault secret</p>
          </div>
        </div>

        <button
          onClick={onTestConnection}
          disabled={isTestingConnection}
          className="px-4 py-2 rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 text-xs font-bold transition-all flex items-center space-x-2 shadow-md"
        >
          <RefreshCw className={`w-3 h-3 ${isTestingConnection ? 'animate-spin' : ''}`} />
          <span>{isTestingConnection ? 'Testing Gateway...' : 'Test ComfyUI Endpoint'}</span>
        </button>
      </div>

      {/* Settings Form & Security Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Form */}
        <form onSubmit={handleSave} className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          
          {/* ComfyUI Endpoint URL */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              ComfyUI Local URL / Cloudflare Tunnel Endpoint
            </label>
            <input
              type="text"
              value={comfyUrl}
              onChange={(e) => setComfyUrl(e.target.value)}
              placeholder="http://127.0.0.1:8188 or https://your-tunnel.trycloudflare.com"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Specify your local PC's ComfyUI port 8188 address or Cloudflare Tunnel URL.
            </p>
          </div>

          {/* Bearer Auth Token */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              Gateway Bearer Authorization Token
            </label>
            <div className="relative">
              <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={maskedAuthToken ? `Current: ${maskedAuthToken} (leave blank to keep)` : 'sec_rtx3060ti_gateway_key_9988'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Incoming requests require header: <code className="text-cyan-400 font-mono">Authorization: Bearer &lt;TOKEN&gt;</code>. The real token is never sent to the browser - leave blank to keep the current one.
            </p>
          </div>

          {/* Encryption Secret Key */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              Master Encryption Secret (AES-256 Vault)
            </label>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-emerald-400 absolute left-3 top-3" />
              <input
                type="password"
                value={encryptionSecret}
                onChange={(e) => setEncryptionSecret(e.target.value)}
                placeholder={maskedEncryptionSecret ? `Current: ${maskedEncryptionSecret} (leave blank to keep)` : '••••••••••••••••'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Used to encrypt sensitive prompts and local media file paths in the SQLite vault. Leave blank to keep the current secret.
            </p>
          </div>

          {/* Toggle: OOM Check */}
          <div className="grid grid-cols-1 gap-4 pt-2">

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div>
                <span className="text-xs font-bold text-slate-200 block">Strict OOM Pre-flight Check</span>
                <span className="text-[11px] text-slate-500">Prevent render if free VRAM &lt; requirement</span>
              </div>
              <input
                type="checkbox"
                checked={autoOomCheck}
                onChange={(e) => setAutoOomCheck(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
              />
            </div>

          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center space-x-2"
          >
            {savedSuccess ? (
              <>
                <Check className="w-4 h-4 text-emerald-300" />
                <span>Settings Saved to Vault!</span>
              </>
            ) : (
              <span>Save Gateway Configurations</span>
            )}
          </button>

        </form>

        {/* Right Col: Cloudflare Tunnel Helper */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2.5 mb-3">
              <div className="p-2 rounded-xl bg-indigo-950 border border-indigo-800 text-indigo-400">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-200">Cloudflare Tunnel Setup</h3>
                <p className="text-[11px] text-slate-400">Expose local PC port 8188 securely</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              To route Google AI Studio Function Calls directly to your local NVIDIA RTX 3060 Ti PC:
            </p>

            <ol className="list-decimal list-inside text-xs text-slate-400 space-y-2 mb-4">
              <li>Start ComfyUI on your local PC (<code className="text-cyan-300 font-mono">127.0.0.1:8188</code>).</li>
              <li>Install <code className="text-cyan-300 font-mono">cloudflared</code> CLI tool on PC.</li>
              <li>Run the tunnel command below to get your HTTPS public URL.</li>
            </ol>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-indigo-300 relative group">
              <code>{cliScript}</code>
              <button
                onClick={handleCopyCli}
                className="absolute right-2 top-2 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Copy Command"
              >
                {copiedCli ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400 flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Encrypted Tunnel: All media and API keys are zero-trust encrypted.</span>
          </div>
        </div>

      </div>

    </div>
  );
};
