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

/**
 * Lightweight reachability probe - does NOT affect VRAM numbers, only the
 * ComfyUI online/offline flag reported alongside real hardware telemetry.
 */
async function isComfyReachable(comfyUrl: string): Promise<boolean> {
  const cleanUrl = comfyUrl.replace(/\/$/, '');
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${cleanUrl}/system_stats`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Exact hardware telemetry: VRAM from nvidia-smi, host RAM from the OS.
 * Throws GpuTelemetryError if nvidia-smi fails - callers must return 503, never mock data.
 */
export async function getSystemStatsInternal(comfyUrl: string = 'http://127.0.0.1:8188'): Promise<SystemStats> {
  const cleanUrl = comfyUrl.replace(/\/$/, '');
  const gpu = await queryNvidiaSmi();

  const vramFreeMb = gpu.vramTotalMb - gpu.vramUsedMb;
  const vramUsagePercent = Math.round((gpu.vramUsedMb / gpu.vramTotalMb) * 100);

  const systemRamTotalMb = Math.round(os.totalmem() / (1024 * 1024));
  const systemRamFreeMb = Math.round(os.freemem() / (1024 * 1024));
  const ramUsedMb = systemRamTotalMb - systemRamFreeMb;

  const comfyOnline = await isComfyReachable(cleanUrl);
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
