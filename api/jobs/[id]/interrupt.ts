import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../../../src/gateway/cloudAuth.js';
import { getJobById, requestInterrupt } from '../../../src/gateway/db/store.pg.js';

/**
 * The cloud can never reach the PC directly, so this only sets a flag - the worker sees it
 * on its next POST /api/worker/progress round trip and interrupts ComfyUI itself locally.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id as string;
  const job = await getJobById(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'interrupted') {
    return res.status(409).json({ error: `Job already ${job.status}, nothing to interrupt.` });
  }

  await requestInterrupt(id);
  res.status(200).json({ success: true });
}
