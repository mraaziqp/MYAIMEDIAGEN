import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../../src/gateway/cloudAuth.js';
import { getJobById } from '../../src/gateway/db/store.pg.js';

/**
 * Polled by ProgressViewer.tsx every ~1.2s while a job is non-terminal - replaces the old
 * SSE stream (GET /api/stream/:promptId), which Vercel's serverless functions can't hold
 * open the way the local Express server used to.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id as string;
  const job = await getJobById(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.status(200).json(job);
}
