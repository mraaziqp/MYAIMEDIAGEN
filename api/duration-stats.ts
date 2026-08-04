import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../src/gateway/cloudAuth.js';
import { getDurationStats } from '../src/gateway/db/store.pg.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;
  const stats = await getDurationStats();
  res.status(200).json({ stats });
}
