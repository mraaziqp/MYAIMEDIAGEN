import type { Job } from '../src/gateway/db/schema.pg.js';

const CLOUD_API_URL = (process.env.CLOUD_API_URL || '').replace(/\/$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';

if (!CLOUD_API_URL) throw new Error('CLOUD_API_URL is not set - point it at your deployed Vercel app.');
if (!WORKER_TOKEN) throw new Error('WORKER_TOKEN is not set - must match the value configured on Vercel.');

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${CLOUD_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WORKER_TOKEN}`,
      ...(init.headers || {}),
    },
  });
}

/** Claims the next queued job, and checks for any pending control signals. */
export async function fetchNextJob(): Promise<{ job: ClaimedJob | null; freeVramRequested: boolean }> {
  const res = await request('/api/worker/next-job');
  const freeVramRequested = res.headers.get('x-free-vram-requested') === '1';
  if (res.status === 204) return { job: null, freeVramRequested };
  if (!res.ok) throw new Error(`GET /api/worker/next-job failed: HTTP ${res.status}`);
  const job = await res.json();
  return { job, freeVramRequested };
}

export type JobPhase = 'preparing' | 'loading' | 'sampling' | 'decoding' | 'saving' | 'uploading';

export interface ProgressPatch {
  percentage?: number;
  phase?: JobPhase;
  // Nullable, not just optional: once sampling ends the step counter must be actively cleared.
  // Omitting it leaves the previous value in the row, so a finished sampler kept showing
  // "Step 4 / 4" all through decode and save as though it were still counting.
  step?: number | null;
  maxSteps?: number | null;
  node?: string;
  nodeTitle?: string;
  etaSeconds?: number;
  elapsedMs?: number;
  vramCurrentMb?: number;
}

/** A claimed job, plus the historical average this model takes (null if never completed). */
export type ClaimedJob = Job & { avgDurationMs: number | null };

/** Returns whether the cloud has flagged this job for interruption since the last check. */
export async function postProgress(jobId: string, patch: ProgressPatch): Promise<{ interruptRequested: boolean }> {
  const res = await request('/api/worker/progress', {
    method: 'POST',
    body: JSON.stringify({ jobId, ...patch }),
  });
  if (!res.ok) throw new Error(`POST /api/worker/progress failed: HTTP ${res.status}`);
  return res.json();
}

export async function postComplete(
  jobId: string,
  data: { mediaUrl: string; durationMs: number; vramPeakMb?: number }
): Promise<void> {
  const res = await request('/api/worker/complete', { method: 'POST', body: JSON.stringify({ jobId, ...data }) });
  if (!res.ok) throw new Error(`POST /api/worker/complete failed: HTTP ${res.status}`);
}

/**
 * Reports a TRANSIENT failure - the cloud requeues the job if it has attempts left, otherwise
 * fails it. Use postFail for anything a retry cannot fix.
 */
export async function postRetry(jobId: string, error: string): Promise<{ retried: boolean; attempts: number }> {
  const res = await request('/api/worker/retry', { method: 'POST', body: JSON.stringify({ jobId, error }) });
  if (!res.ok) throw new Error(`POST /api/worker/retry failed: HTTP ${res.status}`);
  return res.json();
}

export async function postFail(jobId: string, error: string, interrupted = false): Promise<void> {
  const res = await request('/api/worker/fail', {
    method: 'POST',
    body: JSON.stringify({ jobId, error, interrupted }),
  });
  if (!res.ok) throw new Error(`POST /api/worker/fail failed: HTTP ${res.status}`);
}

export interface HeartbeatPayload {
  device?: string;
  vramUsedMb?: number;
  vramTotalMb?: number;
  vramFreeMb?: number;
  systemRamUsedMb?: number;
  systemRamTotalMb?: number;
  comfyOnline: boolean;
  reclaimableVramMb?: number;
  freeVramHandledReclaimedMb?: number;
}

/** Posts heartbeat and receives control signals (such as freeVramRequested) from cloud. */
export async function postHeartbeat(data: HeartbeatPayload): Promise<{ freeVramRequested?: boolean } | null> {
  try {
    const res = await request('/api/worker/heartbeat', { method: 'POST', body: JSON.stringify(data) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
