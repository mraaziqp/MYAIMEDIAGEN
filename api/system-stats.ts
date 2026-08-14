import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../src/gateway/cloudAuth.js';
import { getHeartbeatStatus } from '../src/gateway/db/store.pg.js';
import { runPreflightCheck } from '../src/gateway/vramMonitor.js';

/**
 * Cloud-side replacement for the old live `nvidia-smi` read (vramMonitor.ts's
 * getSystemStatsInternal) - the cloud has no GPU and never calls the PC, so this reads the
 * latest worker_heartbeat row instead. Reports 503 if the worker hasn't reported in recently,
 * same "never fabricate a reading" principle as the original, just with staleness instead of
 * a failed shell-out as the failure signal.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;

  const { online, heartbeat } = await getHeartbeatStatus();
  if (!heartbeat) {
    return res.status(200).json({
      online: false,
      status: 'OFFLINE',
      vramTotalMb: 0,
      vramUsedMb: 0,
      vramFreeMb: 0,
      vramUsagePercent: 0,
      ramUsedMb: 0,
      ramTotalMb: 0,
      systemRamTotalMb: 0,
      systemRamFreeMb: 0,
      oomRisk: false,
      device: 'Offline',
      comfyUrl: '',
      isTunnelConnected: false,
      error: 'Worker never reported in',
      details: 'No heartbeat has ever been received - start the local worker on your PC (see README).',
      preflightCheck: {
        passed: false,
        recommendedMediaType: [],
        warnings: ['No heartbeat received - start the local worker on your PC.'],
      },
    });
  }
  if (!online) {
    const vramFreeMb = heartbeat.vramFreeMb ?? 0;
    const vramTotalMb = heartbeat.vramTotalMb ?? 0;
    const vramUsedMb = heartbeat.vramUsedMb ?? 0;
    const systemRamTotalMb = heartbeat.systemRamTotalMb ?? 0;
    const systemRamUsedMb = heartbeat.systemRamUsedMb ?? 0;
    return res.status(200).json({
      online: false,
      status: 'OFFLINE',
      vramTotalMb,
      vramUsedMb,
      vramFreeMb,
      vramUsagePercent: vramTotalMb > 0 ? Math.round((vramUsedMb / vramTotalMb) * 100) : 0,
      ramUsedMb: systemRamUsedMb,
      ramTotalMb: systemRamTotalMb,
      systemRamTotalMb,
      systemRamFreeMb: systemRamTotalMb - systemRamUsedMb,
      oomRisk: vramFreeMb < 2000,
      device: heartbeat.device || 'Unknown GPU',
      comfyUrl: '',
      isTunnelConnected: false,
      lastSeenAt: heartbeat.lastSeenAt,
      reclaimableVramMb: heartbeat.reclaimableVramMb ?? undefined,
      error: 'Worker offline',
      details: 'Last heartbeat was more than 15s ago - the PC or worker appears to be off.',
      preflightCheck: {
        passed: false,
        recommendedMediaType: [],
        warnings: ['Worker offline - last heartbeat was more than 15s ago.'],
      },
    });
  }

  const vramFreeMb = heartbeat.vramFreeMb ?? 0;
  const vramTotalMb = heartbeat.vramTotalMb ?? 0;
  const vramUsedMb = heartbeat.vramUsedMb ?? 0;
  const systemRamTotalMb = heartbeat.systemRamTotalMb ?? 0;
  const systemRamUsedMb = heartbeat.systemRamUsedMb ?? 0;
  const preflight = runPreflightCheck(vramFreeMb, 'image_fast');

  res.status(200).json({
    online: true,
    vramTotalMb,
    vramUsedMb,
    vramFreeMb,
    vramUsagePercent: vramTotalMb > 0 ? Math.round((vramUsedMb / vramTotalMb) * 100) : 0,
    ramUsedMb: systemRamUsedMb,
    ramTotalMb: systemRamTotalMb,
    oomRisk: vramFreeMb < 2000,
    device: heartbeat.device || 'Unknown GPU',
    status: heartbeat.comfyOnline ? 'ONLINE' : 'OFFLINE',
    comfyUrl: '',
    isTunnelConnected: heartbeat.comfyOnline,
    lastSeenAt: heartbeat.lastSeenAt,
    systemRamTotalMb,
    systemRamFreeMb: systemRamTotalMb - systemRamUsedMb,
    reclaimableVramMb: heartbeat.reclaimableVramMb ?? undefined,
    preflightCheck: {
      passed: preflight.passed,
      recommendedMediaType: preflight.recommendedMediaType,
      warnings: preflight.warnings,
    },
  });
}
