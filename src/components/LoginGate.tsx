import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, Loader2 } from 'lucide-react';

/**
 * The dashboard is now reachable at a real public URL (Vercel), not just on the local
 * network behind a router - this is the shared-password gate that stands in for that lost
 * implicit protection. A signed httpOnly cookie (see cloudAuth.ts) is all that's checked;
 * there's no per-user account system since this is a single-owner tool.
 */
export const LoginGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<'checking' | 'authed' | 'unauthed'>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Reads the body, not the status code: /api/session answers 200 either way now (see
    // api/session.ts) so that an ordinary unauthenticated visit stops logging a console error.
    fetch('/api/session')
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((data) => setStatus(data?.authenticated ? 'authed' : 'unauthed'))
      .catch(() => setStatus('unauthed'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Incorrect password.');
      }
      setStatus('authed');
    } catch (err: any) {
      setError(err?.message || 'Login failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (status === 'unauthed') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-slate-100">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4"
        >
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">Local AI Media Gateway</h1>
              <p className="text-xs text-slate-400">Enter the site password to continue</p>
            </div>
          </div>

          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
          />

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting || !password}
            className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-sm transition-all flex items-center justify-center space-x-2"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>{isSubmitting ? 'Checking...' : 'Unlock'}</span>
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
};
