import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessWorker } from '../../src/gateway/cloudAuth.js';
import { upsertHeartbeat, markFreeVramHandled, getHeartbeatStatus, isFreeVramPending } from '../../src/gateway/db/store.pg.js';

/**
 * Posted every ~5-10s by the local worker (see worker/index.ts). This is the only signal the
 * cloud has for "is the PC/GPU on" - GET /api/system-stats derives Online/Offline purely from
 * how stale the row this writes is, never by contacting the PC.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessWorker(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    device,
    vramUsedMb,
    vramTotalMb,
    vramFreeMb,
    systemRamUsedMb,
    systemRamTotalMb,
    comfyOnline,
    reclaimableVramMb,
    freeVramHandledReclaimedMb,
  } = req.body || {};

  if (freeVramHandledReclaimedMb != null) {
    await markFreeVramHandled(Number(freeVramHandledReclaimedMb));
  }

  await upsertHeartbeat({
    device,
    vramUsedMb: vramUsedMb != null ? Number(vramUsedMb) : undefined,
    vramTotalMb: vramTotalMb != null ? Number(vramTotalMb) : undefined,
    vramFreeMb: vramFreeMb != null ? Number(vramFreeMb) : undefined,
    systemRamUsedMb: systemRamUsedMb != null ? Number(systemRamUsedMb) : undefined,
    systemRamTotalMb: systemRamTotalMb != null ? Number(systemRamTotalMb) : undefined,
    comfyOnline: Boolean(comfyOnline),
    // null (clear it), not undefined (keep the old value) - see upsertHeartbeat. The worker
    // reports this as absent whenever ComfyUI is unreachable, and "unknown" must not be
    // rendered from a figure that was true minutes ago.
    reclaimableVramMb: reclaimableVramMb != null ? Number(reclaimableVramMb) : null,
  });

  const { heartbeat } = await getHeartbeatStatus();
  const freeVramRequested = isFreeVramPending(heartbeat);

  res.status(200).json({ success: true, freeVramRequested });
}
