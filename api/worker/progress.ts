import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessWorker } from '../../src/gateway/cloudAuth.js';
import { getJobById, updateJobProgress } from '../../src/gateway/db/store.pg.js';

/**
 * The response carries interruptRequested back to the worker in the same round trip, so a
 * user clicking Interrupt in the dashboard doesn't need a separate poll to be noticed -
 * see worker/runJob.ts, which checks this after every progress report.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessWorker(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId, percentage, step, maxSteps, node, nodeTitle, etaSeconds, elapsedMs, vramCurrentMb } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  await updateJobProgress(jobId, {
    status: 'processing',
    percentage,
    step,
    maxSteps,
    node,
    nodeTitle,
    etaSeconds,
    elapsedMs,
    vramCurrentMb,
  });

  const job = await getJobById(jobId);
  res.status(200).json({ interruptRequested: job?.interruptRequested ?? false });
}
