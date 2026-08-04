import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessWorker } from '../../src/gateway/cloudAuth.js';
import { completeJob } from '../../src/gateway/db/store.pg.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessWorker(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId, mediaUrl, durationMs, vramPeakMb } = req.body || {};
  if (!jobId || !mediaUrl) return res.status(400).json({ error: 'jobId and mediaUrl are required' });

  await completeJob(jobId, {
    mediaUrl,
    durationMs: Number(durationMs) || 0,
    vramPeakMb: vramPeakMb != null ? Number(vramPeakMb) : undefined,
  });
  res.status(200).json({ success: true });
}
