import React, { useState } from 'react';
import { Cpu, Radio, RefreshCw, Terminal, Copy, Check, ShieldAlert, ShieldCheck, HardDrive } from 'lucide-react';
import { SystemStats } from '../types';

interface WorkerStatusProps {
  stats: SystemStats | null;
  onRefresh: () => void;
}

/**
 * Replaces the old TunnelSettings tab - there's no ComfyUI URL/Bearer token to configure
 * from the cloud dashboard anymore (the cloud never talks to ComfyUI directly, only the
 * worker does, from its own local .env). This is a read-only status view of the one signal
 * the cloud actually has: how recently the worker last checked in.
 */
export const WorkerStatus: React.FC<WorkerStatusProps> = ({ stats, onRefresh }) => {
  const [copied, setCopied] = useState(false);
  const startCommand = 'npx tsx worker/index.ts';

  const handleCopy = () => {
    navigator.clipboard.writeText(startCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isOnline = stats?.status === 'ONLINE' || (!!stats && stats.vramTotalMb > 0);
  const lastSeenLabel = stats?.lastSeenAt
    ? `${Math.max(0, Math.round((Date.now() - new Date(stats.lastSeenAt).getTime()) / 1000))}s ago`
    : null;

  return (
    <div className="space-y-6 text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">Local Worker Status</h2>
            <p className="text-xs text-slate-400">
              The cloud never contacts your PC - it only reads whatever the worker last reported in.
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="px-4 py-2 rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 text-xs font-bold transition-all flex items-center space-x-2 shadow-md"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Refresh</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div
            className={`flex items-center space-x-2 p-3 rounded-xl border text-xs font-semibold ${
              isOnline
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            <Radio className={`w-4 h-4 ${isOnline ? 'text-emerald-400 animate-pulse' : 'text-rose-400'}`} />
            <span>{isOnline ? 'Worker online' : 'Worker offline - no recent heartbeat'}</span>
            {lastSeenLabel && <span className="text-[11px] font-normal opacity-80">(last seen {lastSeenLabel})</span>}
          </div>

          {stats ? (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">GPU</span>
                <span className="text-slate-200 font-bold">{stats.device}</span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">ComfyUI</span>
                <span className={`font-bold ${stats.status === 'ONLINE' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {stats.status === 'ONLINE' ? 'Reachable by worker' : 'Not reachable by worker'}
                </span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">VRAM Free</span>
                <span className="text-cyan-300 font-bold font-mono">{(stats.vramFreeMb / 1024).toFixed(2)} GB</span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">System RAM Free</span>
                <span className="text-indigo-300 font-bold font-mono flex items-center space-x-1">
                  <HardDrive className="w-3 h-3" />
                  <span>{(stats.systemRamFreeMb / 1024).toFixed(1)} GB</span>
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No telemetry to show yet - start the worker on your PC and it'll appear here within a few seconds.
            </p>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2.5 mb-3">
              <div className="p-2 rounded-xl bg-indigo-950 border border-indigo-800 text-indigo-400">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-200">Start the Worker</h3>
                <p className="text-[11px] text-slate-400">Run on the PC with the GPU + ComfyUI</p>
              </div>
            </div>

            <ol className="list-decimal list-inside text-xs text-slate-400 space-y-2 mb-4">
              <li>Start ComfyUI locally (<code className="text-cyan-300 font-mono">127.0.0.1:8188</code>).</li>
              <li>
                Set <code className="text-cyan-300 font-mono">CLOUD_API_URL</code> and{' '}
                <code className="text-cyan-300 font-mono">WORKER_TOKEN</code> in the worker's <code className="text-cyan-300 font-mono">.env</code>.
              </li>
              <li>Run the command below (or double-click <code className="text-cyan-300 font-mono">start-worker.bat</code>).</li>
            </ol>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-indigo-300 relative group">
              <code>{startCommand}</code>
              <button
                onClick={handleCopy}
                className="absolute right-2 top-2 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Copy Command"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div
            className={`p-3 rounded-xl border text-[11px] flex items-center space-x-2 ${
              isOnline
                ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            }`}
          >
            {isOnline ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
            <span>
              {isOnline
                ? 'Generation is available - the worker is polling in.'
                : "Generation is disabled until the worker checks in - the gallery and downloads still work."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
