import React from 'react';
import { Cpu, AlertTriangle, ShieldCheck, ShieldAlert, Activity, HardDrive, Trash2, Sparkles } from 'lucide-react';
import { SystemStats } from '../types';

interface VramGaugeProps {
  stats: SystemStats | null;
  onRefresh: () => void;
  onFreeVram?: () => void;
  isFreeingVram?: boolean;
}

export const VramGauge: React.FC<VramGaugeProps> = ({
  stats,
  onRefresh,
  onFreeVram,
  isFreeingVram = false,
}) => {
  const isOnline = stats?.status === 'ONLINE' || (stats?.online === true && stats?.vramTotalMb > 0);
  if (!stats || !isOnline) {
    return (
      <div className="bg-slate-900/90 border border-rose-800/60 rounded-2xl p-5 sm:p-6 shadow-xl text-slate-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-800 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">Local PC Worker Offline</h3>
              <p className="text-xs text-slate-400">
                {stats?.lastSeenAt
                  ? `Last heartbeat from your PC was ${Math.max(0, Math.round((Date.now() - new Date(stats.lastSeenAt).getTime()) / 1000))}s ago - start the local worker to stream real GPU telemetry and render media.`
                  : 'No recent heartbeat from your PC - start the local worker to stream real GPU telemetry and render media.'}
              </p>
            </div>
          </div>
          <button
            onClick={onRefresh}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all flex items-center space-x-1.5 shadow"
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Retry Connection</span>
          </button>
        </div>
        <div className="flex items-center space-x-2 p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span>Generation is temporarily locked until GPU telemetry reconnects. Existing media in the Vault remains accessible.</span>
        </div>
      </div>
    );
  }

  const usedGb = (stats.vramUsedMb / 1024).toFixed(2);
  const freeGb = (stats.vramFreeMb / 1024).toFixed(2);
  const totalGb = (stats.vramTotalMb / 1024).toFixed(1);
  const vramPercent = stats.vramUsagePercent;
  const isVramLow = stats.vramFreeMb < 3800;

  const preflight = stats.preflightCheck;

  // ComfyUI's /free can only hand back what its own torch allocator is holding (loaded weights
  // plus cache pool), which is what reclaimableVramMb measures - the rest of the GPU's used
  // VRAM belongs to other processes and is untouchable. Below this threshold a purge is churn:
  // it unloads models that will simply be re-read from disk on the next render, costing a cold
  // load (~233s for Flux here) to recover a rounding error.
  const RECLAIM_THRESHOLD_MB = 256;
  // Undefined means the worker hasn't reported the figure (older worker, or ComfyUI
  // unreachable). Unknown is not the same as zero, so allow the action rather than block on
  // an absent measurement.
  const hasReclaimable =
    stats.reclaimableVramMb == null || stats.reclaimableVramMb >= RECLAIM_THRESHOLD_MB;
  const reclaimTitle = hasReclaimable
    ? 'Unload ComfyUI’s loaded models and purge its PyTorch CUDA cache, returning that VRAM to the GPU'
    : 'ComfyUI is not currently holding any releasable VRAM - there is nothing a purge could free';

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl text-slate-100 relative overflow-hidden">

      {/* Background ambient glow */}
      <div className="absolute top-0 right-0 w-80 h-32 bg-cyan-500/5 blur-3xl pointer-events-none -z-0" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 relative z-10">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-950/90 border border-cyan-800/80 text-cyan-400 shadow-inner">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-slate-100">{stats.device}</h3>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-800 border border-slate-700 text-slate-300 rounded-md">
                8GB GDDR6
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              {stats.status === 'ONLINE' ? 'ComfyUI connected & ready on PC' : 'ComfyUI not reachable by worker'}
            </p>
          </div>
        </div>

        {/* Action Buttons: FREE VRAM & Ping */}
        <div className="flex items-center space-x-2.5 self-end sm:self-auto">
          {onFreeVram && (
            <button
              onClick={onFreeVram}
              disabled={isFreeingVram || stats.status !== 'ONLINE' || !hasReclaimable}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                isVramLow && hasReclaimable
                  ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 text-white shadow-rose-500/25 ring-2 ring-rose-500/50 animate-pulse'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-500/25'
              }`}
              title={reclaimTitle}
            >
              <Trash2 className={`w-4 h-4 ${isFreeingVram ? 'animate-spin' : ''}`} />
              {/* Naming the real figure is the point of the whole reclaimable measurement:
                  "RECLAIM 3.2 GB" is a promise the worker can keep, where a bare "FREE VRAM"
                  invited a purge that frees nothing whenever ComfyUI holds nothing. */}
              <span className="tracking-wide">
                {isFreeingVram
                  ? 'FREEING VRAM...'
                  : hasReclaimable
                  ? `RECLAIM ${(stats.reclaimableVramMb! / 1024).toFixed(1)} GB`
                  : 'NOTHING TO RECLAIM'}
              </span>
            </button>
          )}

          <button
            onClick={onRefresh}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition-all flex items-center space-x-1.5 shadow-sm active:scale-95"
            title="Refresh hardware stats immediately"
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Ping Stats</span>
          </button>
        </div>
      </div>

      {/* Main VRAM Bar */}
      <div className="mb-4 relative z-10">
        <div className="flex justify-between items-end mb-1.5 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-slate-300 font-medium">VRAM Allocation</span>
            {stats.reclaimableVramMb != null && stats.reclaimableVramMb > 0 && (
              <span className="text-[10px] text-indigo-300 bg-indigo-950/70 border border-indigo-800/60 px-1.5 py-0.5 rounded">
                ~{(stats.reclaimableVramMb / 1024).toFixed(1)} GB model cache
              </span>
            )}
          </div>
          <span className="font-mono text-cyan-300 font-bold">
            {usedGb} GB / {totalGb} GB ({vramPercent}%)
          </span>
        </div>
        <div className="w-full bg-slate-950 rounded-full h-3.5 p-0.5 border border-slate-800 relative overflow-hidden shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              stats.vramFreeMb < 2000
                ? 'bg-gradient-to-r from-rose-600 to-rose-500 shadow-rose-500/50 shadow-sm'
                : vramPercent > 85
                ? 'bg-gradient-to-r from-amber-500 to-rose-600'
                : vramPercent > 70
                ? 'bg-gradient-to-r from-cyan-500 to-amber-500'
                : 'bg-gradient-to-r from-blue-600 via-cyan-500 to-teal-400'
            }`}
            style={{ width: `${vramPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-slate-500 mt-1.5 font-mono">
          <span>0 GB</span>
          <span className={`font-semibold ${isVramLow ? 'text-amber-400' : 'text-emerald-400'}`}>
            Available: {freeGb} GB Free
          </span>
          <span>{totalGb} GB Total</span>
        </div>
      </div>

      {/* Grid Stats & RAM */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-3 relative z-10">
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3 shadow-inner flex flex-col justify-between">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold tracking-wider">Free VRAM</span>
          <div className="flex items-baseline space-x-1 mt-1">
            <span className={`text-base font-bold font-mono ${isVramLow ? 'text-amber-400' : 'text-emerald-400'}`}>
              {freeGb} GB
            </span>
            <span className="text-[10px] text-slate-500">({stats.vramFreeMb} MB)</span>
          </div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3 shadow-inner flex flex-col justify-between">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold tracking-wider">System Host RAM</span>
          <div className="flex items-center space-x-1.5 mt-1">
            <HardDrive className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-base font-bold font-mono text-indigo-300">
              {(stats.systemRamFreeMb / 1024).toFixed(1)} GB
            </span>
            <span className="text-[10px] text-slate-500">Free</span>
          </div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3 shadow-inner col-span-2 sm:col-span-1 flex flex-col justify-between">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold tracking-wider">ComfyUI Status</span>
          <div className="flex items-center space-x-1.5 mt-1">
            <div className={`w-2 h-2 rounded-full ${stats.status === 'ONLINE' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className={`text-xs font-bold ${stats.status === 'ONLINE' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stats.status === 'ONLINE' ? 'Worker Connected' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* OOM Safety & Interactive Pre-flight Status */}
      <div className="mt-3 relative z-10">
        {preflight.passed ? (
          <div className="flex items-center space-x-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <span className="font-semibold block">OOM Safety Check: Passed</span>
              <span className="text-[11px] text-emerald-400/80">
                Sufficient VRAM available ({freeGb} GB free) for Flux Schnell FP8, SDXL HD, and AnimateDiff Video renders.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {preflight.warnings.map((w, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-amber-950/50 border border-amber-800/70 text-amber-300 text-xs gap-3 shadow-md"
              >
                <div className="flex items-start space-x-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block text-amber-200">Memory Headroom Low</span>
                    <span className="text-[11px] text-amber-300/90">{w}</span>
                  </div>
                </div>

                {/* Low VRAM with nothing reclaimable is a genuinely different situation, and
                    the most useful thing the UI can do is say so: the memory is held by some
                    other process, so a purge cannot help and offering one just wastes a cold
                    model reload. */}
                {onFreeVram && hasReclaimable && (
                  <button
                    onClick={onFreeVram}
                    disabled={isFreeingVram}
                    className="px-4 py-2 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-extrabold rounded-xl text-xs shrink-0 flex items-center justify-center space-x-2 transition-all shadow-lg active:scale-95 disabled:opacity-50 tracking-wide ring-2 ring-rose-400/30"
                    title={reclaimTitle}
                  >
                    <Trash2 className={`w-4 h-4 ${isFreeingVram ? 'animate-spin' : ''}`} />
                    <span>
                      {isFreeingVram
                        ? 'PURGING VRAM...'
                        : stats.reclaimableVramMb != null
                        ? `RECLAIM ${(stats.reclaimableVramMb / 1024).toFixed(1)} GB`
                        : 'FREE VRAM NOW'}
                    </span>
                  </button>
                )}

                {onFreeVram && !hasReclaimable && (
                  <span className="text-[11px] text-amber-300/80 shrink-0 max-w-[16rem]">
                    ComfyUI isn’t holding any releasable VRAM — this memory belongs to another
                    process, so a purge won’t recover it.
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
