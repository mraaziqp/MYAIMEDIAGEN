import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkSitePassword, createSessionCookie } from '../src/gateway/cloudAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (typeof password !== 'string' || !checkSitePassword(password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  res.setHeader('Set-Cookie', createSessionCookie());
  res.status(200).json({ success: true });
}
