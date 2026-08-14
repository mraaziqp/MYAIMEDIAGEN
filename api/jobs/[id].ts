import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../../src/gateway/cloudAuth.js';
import { getJobById, getQueuePosition, getHeartbeatStatus } from '../../src/gateway/db/store.pg.js';

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

  // A still-queued job tells the user nothing on its own - "waiting for your PC" reads
  // identically whether the worker is 10 seconds away or switched off entirely. These two
  // extra reads let the card distinguish "2 jobs ahead of you" from "your PC is offline, so
  // nothing will pick this up". Only fetched while queued, so the ~1.2s poll of a *running*
  // job stays a single lookup.
  if (job.status === 'queued') {
    const [queuePosition, { online }] = await Promise.all([getQueuePosition(id), getHeartbeatStatus()]);
    return res.status(200).json({ ...job, queuePosition, workerOnline: online });
  }

  res.status(200).json(job);
}
