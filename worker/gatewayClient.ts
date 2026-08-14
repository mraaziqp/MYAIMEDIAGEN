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

/** Claims the next queued job, or null if the queue is empty. */
export async function fetchNextJob(): Promise<ClaimedJob | null> {
  const res = await request('/api/worker/next-job');
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`GET /api/worker/next-job failed: HTTP ${res.status}`);
  return res.json();
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
}

/** Best-effort - a dropped heartbeat just means the dashboard shows "offline" a beat late. */
export async function postHeartbeat(data: HeartbeatPayload): Promise<void> {
  await request('/api/worker/heartbeat', { method: 'POST', body: JSON.stringify(data) }).catch(() => {});
}
