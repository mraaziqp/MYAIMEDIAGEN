import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../src/gateway/cloudAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;
  res.status(200).json({ authenticated: true });
}
