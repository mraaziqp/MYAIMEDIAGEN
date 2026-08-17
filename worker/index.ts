// Must run before any other import that reads process.env.* at module load time.
import 'dotenv/config';

import { fetchNextJob, postHeartbeat } from './gatewayClient.js';
import { runJob } from './runJob.js';
import { getSystemStatsInternal, readGpuVram, noteVramPurged, GpuTelemetryError } from '../src/gateway/vramMonitor.js';

const COMFY_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const POLL_INTERVAL_MS = 2000;
// Nominal gap between heartbeats. The loop below subtracts the time its own work took, so this
// is the actual period rather than a floor - see the comment there for why that matters.
const HEARTBEAT_INTERVAL_MS = 5000;
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

  // Measured before the purge so the amount reported back is the memory this action actually
  // recovered, not just how much happens to be free afterwards - the latter includes VRAM
  // other processes were never holding, and would credit the purge with freeing it.
  let vramUsedBeforeMb: number | null = null;
  try {
    vramUsedBeforeMb = (await readGpuVram()).vramUsedMb;
  } catch {
    // Non-fatal: the purge still runs, the reclaimed figure is just reported as unknown.
  }

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

  // 4. Read fresh hardware telemetry immediately and push to cloud without waiting a full cycle.
  try {
    // A just-purged GPU is by definition at its idle floor, so this is the most reliable
    // calibration point there is - feed it in before computing the next reclaimable figure.
    try {
      noteVramPurged((await readGpuVram()).vramUsedMb);
    } catch {
      // Non-fatal: the floor simply keeps whatever value it already had.
    }
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
      freeVramHandledReclaimedMb:
        vramUsedBeforeMb !== null ? Math.max(0, vramUsedBeforeMb - stats.vramUsedMb) : 0,
    });
    const reclaimed = vramUsedBeforeMb !== null ? Math.max(0, vramUsedBeforeMb - stats.vramUsedMb) : null;
    console.log(
      `[worker] VRAM purge done. Reclaimed ${reclaimed === null ? 'unknown' : `${reclaimed} MB`}; free VRAM now ${stats.vramFreeMb} MB. Synced to cloud.`
    );
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
    // Timed from the START of the cycle, not the end. Sleeping a flat interval AFTER the work
    // made the real period `interval + nvidia-smi + ComfyUI probe + Vercel round trip`, so a
    // single cold serverless start (3-8s) stretched the gap past the staleness threshold and
    // the dashboard flashed "Worker Offline" while the worker was perfectly healthy. Holding a
    // fixed cadence keeps the gap stable no matter how slow one round trip happens to be.
    const cycleStartedAt = Date.now();
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
    // Never go fully busy-loop if a cycle somehow overran the whole interval.
    await sleep(Math.max(500, HEARTBEAT_INTERVAL_MS - (Date.now() - cycleStartedAt)));
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

/**
 * A crash anywhere outside the loops' own try/catch used to end the process, and nothing
 * restarted it - which is exactly how the worker ended up dead for 15 hours while ComfyUI sat
 * there running and the dashboard reported GPU telemetry offline. Neither of these conditions
 * is worth dying for: the loops are independently recoverable, so log loudly and keep serving.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[worker] Unhandled promise rejection (continuing):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[worker] Uncaught exception (continuing):', err);
});

/**
 * Keeps a loop running for the life of the process. Previously a throw that escaped either
 * loop hit `Promise.all(...).catch(process.exit(1))` and took the whole worker down with it.
 */
async function supervise(name: string, loop: () => Promise<void>): Promise<void> {
  while (!shuttingDown) {
    try {
      await loop();
      if (!shuttingDown) console.error(`[worker] ${name} returned unexpectedly - restarting it.`);
    } catch (err) {
      console.error(`[worker] ${name} threw - restarting it in ${ERROR_BACKOFF_MS}ms:`, err);
    }
    if (!shuttingDown) await sleep(ERROR_BACKOFF_MS);
  }
}

void Promise.all([supervise('jobLoop', jobLoop), supervise('heartbeatLoop', heartbeatLoop)]);

process.on('SIGINT', () => {
  shuttingDown = true;
  process.exit(0);
});
process.on('SIGTERM', () => {
  shuttingDown = true;
  process.exit(0);
});
