import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { SystemStats, MediaType } from '../types.js';

const execAsync = promisify(exec);

const VRAM_REQUIREMENTS: Record<string, { minFreeMb: number; name: string }> = {
  image_fast: { minFreeMb: 3800, name: 'Flux Schnell FP8' },
  image_hd: { minFreeMb: 5200, name: 'SDXL FP8' },
  video_short: { minFreeMb: 6500, name: 'AnimateDiff / Quantized SVD Video' },
  image: { minFreeMb: 3800, name: 'Standard Image' },
  video: { minFreeMb: 6500, name: 'Standard Video' },
};

export interface PreflightCheckResult {
  passed: boolean;
  recommendedMediaType: MediaType[];
  warnings: string[];
  requiredFreeMb: number;
  vramFreeMb: number;
}

/**
 * Thrown when nvidia-smi cannot be executed or its output cannot be parsed.
 * Callers must surface this as HTTP 503 - never substitute mocked numbers.
 */
export class GpuTelemetryError extends Error {}

interface GpuReading {
  name: string;
  vramUsedMb: number;
  vramTotalMb: number;
}

/**
 * nvidia-smi is a process spawn (~50-100ms), and it is now read from two independent loops in
 * the worker: the ~7s heartbeat and the ~2s progress ticker. Uncached that is ~38 spawns a
 * minute during a render, most of them reporting a value another caller just fetched. A TTL
 * slightly under the fastest caller's interval collapses those into one spawn per tick while
 * staying well inside "live" - no reading is ever served older than TTL, so this trades no
 * accuracy for the saving. In-flight requests share one promise so concurrent callers can't
 * both spawn.
 */
const GPU_READ_TTL_MS = 1500;
let gpuCache: { reading: GpuReading; at: number } | null = null;
let gpuInFlight: Promise<GpuReading> | null = null;

/**
 * Lowest VRAM-used figure seen so far, i.e. the idle floor: CUDA context plus whatever other
 * processes hold, with no model loaded. Anything above it is memory ComfyUI can hand back.
 *
 * This replaces ComfyUI's `torch_vram_total` as the basis for "reclaimable". That field looked
 * like the right answer but is wrong on this setup: measured directly, it reported 64 MB while
 * ComfyUI's /free went on to release 4580 MB. The GPU runs torch's `cudaMallocAsync` allocator
 * (visible in the device name), under which the reserved-bytes counter does not track real
 * usage - so trusting it would report "nothing to reclaim" with 4.5 GB genuinely wasted.
 *
 * A running minimum needs no persistence and cannot overstate: it only ever falls, and every
 * idle moment refines it. SAMPLES_BEFORE_TRUSTED avoids publishing a figure derived from a
 * floor that is really just "the first reading we happened to take" - until then the value is
 * reported as unknown, which callers must treat as "not measured", never as zero.
 */
let observedFloorMb: number | null = null;
let floorSampleCount = 0;
const SAMPLES_BEFORE_TRUSTED = 4;

/** Reset after a purge so the post-purge idle reading can re-establish the floor immediately. */
export function noteVramPurged(usedMbAfterPurge: number): void {
  observedFloorMb = observedFloorMb === null ? usedMbAfterPurge : Math.min(observedFloorMb, usedMbAfterPurge);
}

function recordFloor(usedMb: number): void {
  observedFloorMb = observedFloorMb === null ? usedMb : Math.min(observedFloorMb, usedMb);
  floorSampleCount += 1;
}

/** Memory ComfyUI is holding above the idle floor, or undefined while the floor is unproven. */
export function estimateReclaimableMb(currentUsedMb: number, torchReservedMb?: number): number | undefined {
  if (observedFloorMb === null || floorSampleCount < SAMPLES_BEFORE_TRUSTED) return undefined;
  const aboveFloor = Math.max(0, currentUsedMb - observedFloorMb);
  // Take whichever signal claims more. Either one reading high is evidence there is something
  // to free; requiring both to agree would reintroduce the false negative this replaced.
  return Math.max(aboveFloor, torchReservedMb ?? 0);
}

async function readGpu(): Promise<GpuReading> {
  if (gpuCache && Date.now() - gpuCache.at < GPU_READ_TTL_MS) return gpuCache.reading;
  if (gpuInFlight) return gpuInFlight;

  gpuInFlight = queryNvidiaSmi()
    .then((reading) => {
      gpuCache = { reading, at: Date.now() };
      recordFloor(reading.vramUsedMb);
      return reading;
    })
    .finally(() => {
      gpuInFlight = null;
    });

  return gpuInFlight;
}

export interface GpuVramReading {
  vramUsedMb: number;
  vramTotalMb: number;
  vramFreeMb: number;
}

/**
 * VRAM only - no ComfyUI round trip. The progress ticker needs nothing else, and calling the
 * full getSystemStatsInternal there meant an HTTP request to ComfyUI every 2s purely to
 * recompute an online/offline flag the ticker never reads.
 */
export async function readGpuVram(): Promise<GpuVramReading> {
  const gpu = await readGpu();
  return {
    vramUsedMb: gpu.vramUsedMb,
    vramTotalMb: gpu.vramTotalMb,
    vramFreeMb: gpu.vramTotalMb - gpu.vramUsedMb,
  };
}

/**
 * Reads exact VRAM usage directly from the NVIDIA driver via nvidia-smi.
 * This bypasses ComfyUI's /system_stats entirely since it lags/misreports under load.
 */
async function queryNvidiaSmi(): Promise<GpuReading> {
  let stdout: string;
  try {
    ({ stdout } = await execAsync(
      'nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader,nounits',
      { timeout: 4000 }
    ));
  } catch (err: any) {
    throw new GpuTelemetryError(
      `nvidia-smi execution failed (is the NVIDIA driver installed and on PATH?): ${err?.message || 'unknown error'}`
    );
  }

  const line = stdout.trim().split('\n')[0];
  if (!line) {
    throw new GpuTelemetryError('nvidia-smi returned no GPU data.');
  }

  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 3) {
    throw new GpuTelemetryError(`Unexpected nvidia-smi output format: "${line}"`);
  }

  const [name, usedStr, totalStr] = parts;
  const vramUsedMb = Number(usedStr);
  const vramTotalMb = Number(totalStr);

  if (!Number.isFinite(vramUsedMb) || !Number.isFinite(vramTotalMb) || vramTotalMb <= 0) {
    throw new GpuTelemetryError(`Failed to parse nvidia-smi memory values from: "${line}"`);
  }

  return { name, vramUsedMb, vramTotalMb };
}

export interface ComfyProbe {
  online: boolean;
  /**
   * VRAM torch has reserved on ComfyUI's device - i.e. loaded model weights plus its caching
   * allocator's pool. This is precisely the memory ComfyUI's /free endpoint can hand back, so
   * it is the only honest basis for a "reclaim memory" action: it reads 0 when nothing is
   * loaded, rather than tempting the user to "free" VRAM that belongs to other processes and
   * that ComfyUI has no ability to release.
   */
  torchVramReservedMb?: number;
}

/**
 * Reachability probe that also returns ComfyUI's own memory accounting. The response body was
 * previously fetched and discarded, so this costs nothing extra - the request was already
 * being made on every telemetry read.
 */
async function probeComfy(comfyUrl: string): Promise<ComfyProbe> {
  const cleanUrl = comfyUrl.replace(/\/$/, '');
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${cleanUrl}/system_stats`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { online: false };

    const body: any = await res.json().catch(() => null);
    const reserved = body?.devices?.[0]?.torch_vram_total;
    return {
      online: true,
      torchVramReservedMb: typeof reserved === 'number' ? Math.round(reserved / (1024 * 1024)) : undefined,
    };
  } catch {
    return { online: false };
  }
}

/**
 * Exact hardware telemetry: VRAM from nvidia-smi, host RAM from the OS.
 * Throws GpuTelemetryError if nvidia-smi fails - callers must return 503, never mock data.
 */
export async function getSystemStatsInternal(comfyUrl: string = 'http://127.0.0.1:8188'): Promise<SystemStats> {
  const cleanUrl = comfyUrl.replace(/\/$/, '');
  // Both reads are independent - run them concurrently rather than serially. The nvidia-smi
  // spawn and the ComfyUI round trip were previously awaited one after the other, so every
  // telemetry read cost the sum of the two rather than the slower of them.
  const [gpu, comfy] = await Promise.all([readGpu(), probeComfy(cleanUrl)]);

  const vramFreeMb = gpu.vramTotalMb - gpu.vramUsedMb;
  const vramUsagePercent = Math.round((gpu.vramUsedMb / gpu.vramTotalMb) * 100);

  const systemRamTotalMb = Math.round(os.totalmem() / (1024 * 1024));
  const systemRamFreeMb = Math.round(os.freemem() / (1024 * 1024));
  const ramUsedMb = systemRamTotalMb - systemRamFreeMb;

  const comfyOnline = comfy.online;
  const preflight = runPreflightCheck(vramFreeMb, 'image_fast');

  return {
    vramTotalMb: gpu.vramTotalMb,
    vramUsedMb: gpu.vramUsedMb,
    vramFreeMb,
    vramUsagePercent,
    ramUsedMb,
    ramTotalMb: systemRamTotalMb,
    oomRisk: vramFreeMb < 2000,
    device: gpu.name,
    status: comfyOnline ? 'ONLINE' : 'OFFLINE',
    comfyUrl: cleanUrl,
    isTunnelConnected: comfyOnline,
    systemRamTotalMb,
    systemRamFreeMb,
    // Only meaningful when ComfyUI is actually up - it is the only process whose memory this
    // app can release, so attributing headroom to it while it is down would be a false offer.
    reclaimableVramMb: comfyOnline ? estimateReclaimableMb(gpu.vramUsedMb, comfy.torchVramReservedMb) : undefined,
    preflightCheck: {
      passed: preflight.passed,
      recommendedMediaType: preflight.recommendedMediaType,
      warnings: preflight.warnings,
    },
  };
}

/**
 * Pre-flight VRAM memory check to prevent Out-Of-Memory (OOM) GPU crashes
 */
export function runPreflightCheck(freeVramMb: number, requestedMediaType: MediaType): PreflightCheckResult {
  const reqKey = (requestedMediaType as string) || 'image_fast';
  const req = VRAM_REQUIREMENTS[reqKey] || VRAM_REQUIREMENTS.image_fast;
  const warnings: string[] = [];
  const recommendedMediaType: MediaType[] = [];

  if (freeVramMb >= VRAM_REQUIREMENTS.image_fast.minFreeMb) {
    recommendedMediaType.push('image_fast');
  }
  if (freeVramMb >= VRAM_REQUIREMENTS.image_hd.minFreeMb) {
    recommendedMediaType.push('image_hd');
  }
  if (freeVramMb >= VRAM_REQUIREMENTS.video_short.minFreeMb) {
    recommendedMediaType.push('video_short');
  }

  const passed = freeVramMb >= req.minFreeMb;

  if (!passed) {
    warnings.push(
      `[OOM Pre-Flight Warning] ${req.name} requires at least ${req.minFreeMb} MB free VRAM. Currently available: ${freeVramMb} MB on RTX 3060 Ti.`
    );
  }

  return {
    passed,
    recommendedMediaType,
    warnings,
    requiredFreeMb: req.minFreeMb,
    vramFreeMb: freeVramMb,
  };
}
