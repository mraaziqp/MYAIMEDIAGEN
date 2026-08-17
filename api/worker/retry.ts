import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessWorker } from '../../src/gateway/cloudAuth.js';
import { retryOrFailJob } from '../../src/gateway/db/store.pg.js';

/**
 * Returns a job to the queue after a transient infrastructure failure, or fails it permanently
 * once its attempt budget is spent. Separate from /api/worker/fail because only the worker can
 * tell the two apart: a dropped WebSocket is worth another go, a missing checkpoint never is.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessWorker(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId, error } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  const result = await retryOrFailJob(jobId, String(error ?? 'Transient worker failure'));
  res.status(200).json(result);
}
