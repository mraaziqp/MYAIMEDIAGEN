import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessWorker } from '../../src/gateway/cloudAuth.js';
import { claimNextJob, getAvgDurationMs } from '../../src/gateway/db/store.pg.js';

/**
 * Polled by the local worker every ~2s (see worker/index.ts). This is the only inbound
 * direction in the whole architecture - the worker always initiates, the cloud never calls
 * out to the PC - so no tunnel or open port on the PC is needed for generation to work.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessWorker(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const job = await claimNextJob();
  if (!job) return res.status(204).end();

  // The worker holds no job history of its own, so the historical average rides along with the
  // claim. Null when this model has never completed here - the worker must treat that as
  // "no ETA available", not as zero.
  const avgDurationMs = await getAvgDurationMs(job.modelType);
  res.status(200).json({ ...job, avgDurationMs });
}
