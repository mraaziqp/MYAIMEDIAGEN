import crypto from 'crypto';
import { parse as parseCookieHeader, serialize as serializeCookie } from 'cookie';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const SESSION_COOKIE_NAME = 'ai_gateway_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Simple shared-password gate for the now-publicly-reachable dashboard: a signed, httpOnly
 * cookie carrying only an expiry timestamp - no session store needed since there's exactly
 * one password and one "user" (the site owner). Signature prevents forging an expiry
 * extension without knowing SESSION_SECRET.
 */
export function createSessionCookie(): string {
  const secret = requireEnv('SESSION_SECRET');
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const payload = String(expiresAt);
  const value = `${payload}.${sign(payload, secret)}`;
  return serializeCookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE_NAME, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

function verifySessionCookieValue(value: string | undefined): boolean {
  if (!value) return false;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;

  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;
  if (sign(payload, secret) !== sig) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

/**
 * Guards every browser-facing /api route. Returns true (and has already written a 401
 * response) if the request should be rejected - callers just `if (rejectUnlessAuthed(...))
 * return;`.
 */
export function rejectUnlessAuthed(req: VercelRequest, res: VercelResponse): boolean {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  if (verifySessionCookieValue(cookies[SESSION_COOKIE_NAME])) return false;
  res.status(401).json({ error: 'Not authenticated. Log in with the site password first.' });
  return true;
}

/**
 * Guards every worker-facing /api/worker/* route with a separate bearer token - the local
 * worker never has (and never needs) the site's session cookie, and the site password isn't
 * meant to double as a machine credential.
 */
export function rejectUnlessWorker(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.WORKER_TOKEN;
  const header = req.headers.authorization || '';
  const token = Array.isArray(header) ? header[0] : header;
  const bearer = token.replace(/^Bearer\s+/i, '').trim();

  if (expected && bearer === expected) return false;
  res.status(401).json({ error: 'Unauthorized: missing or invalid worker Bearer token.' });
  return true;
}

export function checkSitePassword(candidate: string): boolean {
  const expected = process.env.SITE_PASSWORD;
  if (!expected || !candidate) return false;
  // Constant-time comparison - this is a shared secret gate, not throwaway UI state.
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
