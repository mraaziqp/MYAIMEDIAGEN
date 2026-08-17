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
/** True while a render is in flight system-wide (server-derived, so true on every device). */
export function isRenderInFlight(stats: SystemStats | null): boolean {
  return !!stats?.activeJob;
}

export function hasReclaimableVram(stats: SystemStats | null): boolean {
  if (!stats) return false;
  // ComfyUI is the only process whose memory this app can release, so if it is not running there
  // is nothing to reclaim by definition - regardless of what the last heartbeat happened to say.
  if (stats.status !== 'ONLINE') return false;
  // Purging mid-render unloads the very weights the GPU is using and destroys the generation.
  // The worker refuses it locally and POST /api/free-vram refuses it cloud-side, so this is the
  // third layer - but it is the one that matters to the user, because the other two can only
  // reject a click that should never have been offered.
  if (isRenderInFlight(stats)) return false;
  const mb = stats.reclaimableVramMb;
  return mb == null || mb >= RECLAIM_THRESHOLD_MB;
}

/** Names the real figure when known, so the button promises only what it can deliver. */
export function reclaimButtonLabel(stats: SystemStats | null, isFreeing: boolean): string {
  if (isFreeing) return 'FREEING VRAM...';
  if (isRenderInFlight(stats)) return 'RENDER IN PROGRESS';
  if (!hasReclaimableVram(stats)) return 'NOTHING TO RECLAIM';
  const mb = stats?.reclaimableVramMb;
  return mb == null ? 'FREE VRAM' : `RECLAIM ${(mb / 1024).toFixed(1)} GB`;
}

export function reclaimTooltip(stats: SystemStats | null): string {
  if (isRenderInFlight(stats)) {
    return 'A render is currently running - clearing VRAM now would unload the model it is using and kill the generation';
  }
  return hasReclaimableVram(stats)
    ? 'Unload ComfyUI’s loaded models and purge its PyTorch CUDA cache, returning that VRAM to the GPU'
    : 'ComfyUI is not currently holding any releasable VRAM - there is nothing a purge could free';
}
