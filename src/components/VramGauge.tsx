import React from 'react';
import { Cpu, AlertTriangle, ShieldCheck, ShieldAlert, Activity, HardDrive, Zap } from 'lucide-react';
import { SystemStats } from '../types';

interface VramGaugeProps {
  stats: SystemStats | null;
  onRefresh: () => void;
  onFreeVram: () => void;
  isFreeingVram: boolean;
}

export const VramGauge: React.FC<VramGaugeProps> = ({ stats, onRefresh, onFreeVram, isFreeingVram }) => {
  if (!stats) {
    return (
      <div className="bg-slate-900/90 border border-rose-800/60 rounded-2xl p-5 shadow-xl text-slate-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-800 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">GPU Telemetry Unavailable</h3>
              <p className="text-xs text-slate-400">nvidia-smi could not be read - no VRAM data to display</p>
            </div>
          </div>
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all flex items-center space-x-1.5"
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Retry</span>
          </button>
        </div>
        <div className="flex items-center space-x-2 p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>Rendering is disabled until real GPU telemetry is available again.</span>
        </div>
      </div>
    );
  }

  const usedGb = (stats.vramUsedMb / 1024).toFixed(2);
  const freeGb = (stats.vramFreeMb / 1024).toFixed(2);
  const totalGb = (stats.vramTotalMb / 1024).toFixed(1);
  const vramPercent = stats.vramUsagePercent;

  const preflight = stats.preflightCheck;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl text-slate-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-200">{stats.device}</h3>
            <p className="text-xs text-slate-400 font-mono">{stats.comfyUrl}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {stats.status === 'ONLINE' && (
            <button
              onClick={onFreeVram}
              disabled={isFreeingVram}
              title="Unload models from ComfyUI to free VRAM"
              className="px-3 py-1.5 rounded-lg bg-amber-950 hover:bg-amber-900 disabled:opacity-50 disabled:cursor-not-allowed text-amber-300 border border-amber-800 text-xs font-medium transition-all flex items-center space-x-1.5"
            >
              <Zap className={`w-3.5 h-3.5 text-amber-400 ${isFreeingVram ? 'animate-pulse' : ''}`} />
              <span>{isFreeingVram ? 'Freeing...' : 'Free VRAM'}</span>
            </button>
          )}
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all flex items-center space-x-1.5"
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Ping Stats</span>
          </button>
        </div>
      </div>

      {/* Main VRAM Bar */}
      <div className="mb-4">
        <div className="flex justify-between items-end mb-1.5 text-xs">
          <span className="text-slate-400 font-medium">VRAM Allocation (8GB Limit)</span>
          <span className="font-mono text-cyan-300 font-semibold">
            {usedGb} GB / {totalGb} GB ({vramPercent}%)
          </span>
        </div>
        <div className="w-full bg-slate-950 rounded-full h-3.5 p-0.5 border border-slate-800 relative overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              stats.vramFreeMb < 2000
                ? 'bg-gradient-to-r from-rose-600 to-rose-500'
                : vramPercent > 85
                ? 'bg-gradient-to-r from-amber-500 to-rose-600'
                : vramPercent > 70
                ? 'bg-gradient-to-r from-cyan-500 to-amber-500'
                : 'bg-gradient-to-r from-blue-600 via-cyan-500 to-teal-400'
            }`}
            style={{ width: `${vramPercent}%` }}
          />
        </div>
        {stats.vramFreeMb < 2000 && (
          <p className="text-[11px] text-rose-400 font-semibold mt-1">
            Free VRAM below 2000 MB safety threshold - Generate is disabled.
          </p>
        )}
        <div className="flex justify-between text-[11px] text-slate-500 mt-1 font-mono">
          <span>0 GB</span>
          <span>Free: {freeGb} GB</span>
          <span>8.0 GB Max</span>
        </div>
      </div>

      {/* Grid Stats & RAM */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-3">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Free VRAM</span>
          <span className="text-sm font-bold font-mono text-emerald-400">{freeGb} GB</span>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">System RAM Free</span>
          <div className="flex items-center space-x-1">
            <HardDrive className="w-3 h-3 text-indigo-400" />
            <span className="text-sm font-bold font-mono text-indigo-300">
              {(stats.systemRamFreeMb / 1024).toFixed(1)} GB
            </span>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 col-span-2 sm:col-span-1">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">ComfyUI Connection</span>
          <span className={`text-xs font-bold ${stats.isTunnelConnected ? 'text-cyan-400' : 'text-amber-400'}`}>
            {stats.status === 'ONLINE' ? 'Connected' : 'Offline'}
          </span>
        </div>
      </div>

      {/* OOM Safety & Pre-flight Status */}
      <div className="mt-3">
        {preflight.passed ? (
          <div className="flex items-center space-x-2 p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <span className="font-semibold block">OOM Safety Check: Passed</span>
              <span className="text-[11px] text-emerald-400/80">
                Sufficient VRAM available for Flux FP8, SDXL, and Short Video renders.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {preflight.warnings.map((w, idx) => (
              <div
                key={idx}
                className="flex items-start space-x-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs"
              >
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
