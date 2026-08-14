// Must run before any other import that reads process.env.* at module load time.
import 'dotenv/config';

import { fetchNextJob, postHeartbeat } from './gatewayClient.js';
import { runJob } from './runJob.js';
import { getSystemStatsInternal, GpuTelemetryError } from '../src/gateway/vramMonitor.js';

const COMFY_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 7000;
const ERROR_BACKOFF_MS = 5000;

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let isJobRunning = false;

/**
 * Sends /free and /interrupt to ComfyUI to unload models and purge PyTorch CUDA cache allocator pool,
 * then IMMEDIATELY reads fresh GPU hardware stats and syncs them to the cloud.
 */
async function executeFreeVramAndSync(): Promise<void> {
  if (isJobRunning) return;
  console.log('[worker] Purge VRAM signal detected. Calling ComfyUI /free to unload models & purge GPU memory...');
  const cleanUrl = COMFY_URL.replace(/\/$/, '');
  try {
    // 1. Send /interrupt in case anything is paused
    await fetch(`${cleanUrl}/interrupt`, { method: 'POST' }).catch(() => {});
    // 2. Send /free
    const res = await fetch(`${cleanUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    if (!res.ok) {
      console.warn(`[worker] ComfyUI /free returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('[worker] Error calling ComfyUI /free:', err);
  }

  // 3. Give CUDA memory allocator 1.2s to release memory back to driver
  await sleep(1200);

  // 4. Read fresh hardware telemetry immediately and push to cloud without waiting 7s!
  try {
    const stats = await getSystemStatsInternal(COMFY_URL);
    await postHeartbeat({
      device: stats.device,
      vramUsedMb: stats.vramUsedMb,
      vramTotalMb: stats.vramTotalMb,
      vramFreeMb: stats.vramFreeMb,
      systemRamUsedMb: stats.systemRamTotalMb - stats.systemRamFreeMb,
      systemRamTotalMb: stats.systemRamTotalMb,
      comfyOnline: stats.status === 'ONLINE',
      reclaimableVramMb: stats.reclaimableVramMb,
      freeVramHandledReclaimedMb: stats.vramFreeMb,
    });
    console.log(`[worker] VRAM freed successfully! Free VRAM now: ${stats.vramFreeMb} MB. Synced to cloud.`);
  } catch (err) {
    console.error('[worker] Failed to sync telemetry after freeing VRAM:', err);
  }
}

/**
 * Posts real VRAM/RAM/ComfyUI-reachability telemetry every ~7s - this is the only signal the
 * cloud dashboard has for "is my PC on" (see api/system-stats.ts, which derives Online/Offline
 * purely from how stale the last row here is). A failed read is skipped rather than
 * papered over - a missed heartbeat just makes the dashboard honestly show "offline" a beat
 * sooner, matching this app's long-standing "never fabricate a reading" rule.
 */
async function heartbeatLoop(): Promise<void> {
  while (!shuttingDown) {
    try {
      const stats = await getSystemStatsInternal(COMFY_URL);
      const res = await postHeartbeat({
        device: stats.device,
        vramUsedMb: stats.vramUsedMb,
        vramTotalMb: stats.vramTotalMb,
        vramFreeMb: stats.vramFreeMb,
        systemRamUsedMb: stats.systemRamTotalMb - stats.systemRamFreeMb,
        systemRamTotalMb: stats.systemRamTotalMb,
        comfyOnline: stats.status === 'ONLINE',
        reclaimableVramMb: stats.reclaimableVramMb,
      });

      if (res?.freeVramRequested && !isJobRunning) {
        await executeFreeVramAndSync();
      }
    } catch (err) {
      if (err instanceof GpuTelemetryError) {
        console.error(`[worker] GPU telemetry unavailable: ${err.message}`);
      } else {
        console.error('[worker] Heartbeat failed:', err);
      }
    }
    await sleep(HEARTBEAT_INTERVAL_MS);
  }
}

/**
 * The only inbound direction in this whole architecture is this loop polling OUT to the
 * cloud - no port on the PC is ever opened, no tunnel is needed for generation to work.
 */
async function jobLoop(): Promise<void> {
  while (!shuttingDown) {
    try {
      const { job, freeVramRequested } = await fetchNextJob();

      if (freeVramRequested && !isJobRunning) {
        await executeFreeVramAndSync();
      }

      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      console.log(`[worker] Claimed job ${job.id} (${job.modelType})`);
      isJobRunning = true;
      try {
        await runJob(job, COMFY_URL);
      } finally {
        isJobRunning = false;
      }
      console.log(`[worker] Finished job ${job.id}`);
    } catch (err) {
      isJobRunning = false;
      console.error('[worker] Job loop error:', err);
      await sleep(ERROR_BACKOFF_MS);
    }
  }
}

console.log('===============================================');
console.log('  Local AI Media Gateway Worker');
console.log(`  Cloud API: ${process.env.CLOUD_API_URL || '(CLOUD_API_URL not set!)'}`);
console.log(`  ComfyUI:   ${COMFY_URL}`);
console.log('===============================================');

Promise.all([jobLoop(), heartbeatLoop()]).catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  shuttingDown = true;
  process.exit(0);
});
process.on('SIGTERM', () => {
  shuttingDown = true;
  process.exit(0);
});
