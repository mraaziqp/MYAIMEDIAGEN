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
    return res.status(503).json({
      error: 'Worker never reported in',
      details: 'No heartbeat has ever been received - start the local worker on your PC (see README).',
    });
  }
  if (!online) {
    return res.status(503).json({
      error: 'Worker offline',
      details: 'Last heartbeat was more than 15s ago - the PC or worker appears to be off.',
      lastSeenAt: heartbeat.lastSeenAt,
    });
  }

  const vramFreeMb = heartbeat.vramFreeMb ?? 0;
  const vramTotalMb = heartbeat.vramTotalMb ?? 0;
  const vramUsedMb = heartbeat.vramUsedMb ?? 0;
  const systemRamTotalMb = heartbeat.systemRamTotalMb ?? 0;
  const systemRamUsedMb = heartbeat.systemRamUsedMb ?? 0;
  const preflight = runPreflightCheck(vramFreeMb, 'image_fast');

  res.status(200).json({
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
    preflightCheck: {
      passed: preflight.passed,
      recommendedMediaType: preflight.recommendedMediaType,
      warnings: preflight.warnings,
    },
  });
}
