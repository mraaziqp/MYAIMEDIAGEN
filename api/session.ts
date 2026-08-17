import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthed } from '../src/gateway/cloudAuth.js';

/**
 * Deliberately 200 in BOTH cases, unlike every other browser-facing route.
 *
 * This endpoint asks "what is my session state?", and "not logged in" is a valid answer to that
 * question rather than a failure to answer it. Returning 401 made the browser log a red console
 * error on every single first page load - the app's most common code path - which is
 * indistinguishable in devtools from a real fault and buried genuine errors in noise.
 *
 * Routes that actually guard something still use rejectUnlessAuthed and still return 401.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ authenticated: isAuthed(req) });
}
