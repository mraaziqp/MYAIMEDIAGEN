import { SystemStats } from '../types';

/**
 * Single source of truth for "is reclaiming VRAM worth offering right now".
 *
 * This lived inline in VramGauge, so the FREE VRAM buttons in Navbar, GeneratorPanel and
 * WorkerStatus stayed ungated and would happily fire a purge that frees nothing - which is not
 * harmless: it unloads the resident checkpoint, so the next render pays a full cold load (~300s
 * for Flux on this machine) to recover a rounding error. Four copies of a threshold is also
 * four chances to drift, so the rule lives here once.
 */

/**
 * Below this, a purge is churn rather than a win. ComfyUI's /free can only return what its own
 * torch allocator holds; the remainder of the GPU's used VRAM belongs to other processes and is
 * untouchable from here.
 */
export const RECLAIM_THRESHOLD_MB = 256;

/**
 * Undefined reclaimable means "not measured" (older worker, or ComfyUI unreachable) - which is
 * NOT the same as zero, so the action stays available rather than being blocked on a missing
 * measurement.
 */
export function hasReclaimableVram(stats: SystemStats | null): boolean {
  if (!stats) return false;
  const mb = stats.reclaimableVramMb;
  return mb == null || mb >= RECLAIM_THRESHOLD_MB;
}

/** Names the real figure when known, so the button promises only what it can deliver. */
export function reclaimButtonLabel(stats: SystemStats | null, isFreeing: boolean): string {
  if (isFreeing) return 'FREEING VRAM...';
  if (!hasReclaimableVram(stats)) return 'NOTHING TO RECLAIM';
  const mb = stats?.reclaimableVramMb;
  return mb == null ? 'FREE VRAM' : `RECLAIM ${(mb / 1024).toFixed(1)} GB`;
}

export function reclaimTooltip(stats: SystemStats | null): string {
  return hasReclaimableVram(stats)
    ? 'Unload ComfyUI’s loaded models and purge its PyTorch CUDA cache, returning that VRAM to the GPU'
    : 'ComfyUI is not currently holding any releasable VRAM - there is nothing a purge could free';
}
