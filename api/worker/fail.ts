import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessWorker } from '../../src/gateway/cloudAuth.js';
import { failJob } from '../../src/gateway/db/store.pg.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessWorker(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId, error, interrupted } = req.body || {};
  if (!jobId || !error) return res.status(400).json({ error: 'jobId and error are required' });

  await failJob(jobId, { error, status: interrupted ? 'interrupted' : 'failed' });
  res.status(200).json({ success: true });
}
