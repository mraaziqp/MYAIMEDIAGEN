import { spawn, ChildProcess } from 'child_process';

export interface TunnelStatus {
  status: 'disabled' | 'starting' | 'connected' | 'error';
  url: string | null;
  error: string | null;
}

// Matches the URL cloudflared prints when a quick tunnel (trycloudflare.com) comes up -
// confirmed against real cloudflared 2026.5.0 output, not guessed from docs.
const QUICK_TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

// Real cloudflared log line emitted once a named tunnel's connection to Cloudflare's edge is
// actually live - used as the only signal to report 'connected' for a named tunnel, since
// (unlike a quick tunnel) the hostname is already known upfront and isn't proof of anything
// by itself.
const NAMED_TUNNEL_CONNECTED_PATTERN = /Registered tunnel connection/i;

let tunnelProcess: ChildProcess | null = null;
let currentStatus: TunnelStatus = { status: 'disabled', url: null, error: null };

export function getTunnelStatus(): TunnelStatus {
  return { ...currentStatus };
}

/**
 * Starts the gateway's public tunnel, pointed at its own port. Two modes, selected by
 * whether CLOUDFLARE_TUNNEL_NAME + CLOUDFLARE_TUNNEL_HOSTNAME are set in the environment:
 *
 * - Named tunnel (both set): a fixed hostname on a domain already in the user's Cloudflare
 *   account, set up once via `cloudflared tunnel login` / `tunnel create` / `tunnel route
 *   dns` (see README) - the public URL never changes across restarts.
 * - Quick tunnel (default, no setup): a random trycloudflare.com URL that changes every
 *   restart - what this app has always done, kept as the zero-config default.
 *
 * Non-fatal in both modes if `cloudflared` isn't installed.
 */
export function startTunnel(port: number): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }

  currentStatus = { status: 'starting', url: null, error: null };

  const tunnelName = process.env.CLOUDFLARE_TUNNEL_NAME;
  const tunnelHostname = process.env.CLOUDFLARE_TUNNEL_HOSTNAME;

  const args =
    tunnelName && tunnelHostname
      ? ['tunnel', 'run', '--url', `http://127.0.0.1:${port}`, tunnelName]
      : ['tunnel', '--url', `http://127.0.0.1:${port}`];

  let proc: ChildProcess;
  try {
    proc = spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err: any) {
    currentStatus = { status: 'error', url: null, error: `Failed to spawn cloudflared: ${err?.message}` };
    return;
  }

  tunnelProcess = proc;

  proc.on('error', (err) => {
    // ENOENT means cloudflared isn't on PATH - a real, expected case on machines that
    // don't have it installed. Report it plainly rather than crashing the gateway.
    currentStatus = {
      status: 'error',
      url: null,
      error: (err as any)?.code === 'ENOENT' ? 'cloudflared is not installed / not on PATH' : err.message,
    };
  });

  const onOutput = (data: Buffer) => {
    const text = data.toString();
    if (currentStatus.status === 'connected') return;

    if (tunnelName && tunnelHostname) {
      // The hostname is fixed and known from config - only the "actually connected" fact
      // needs confirming from real cloudflared output before reporting it.
      if (NAMED_TUNNEL_CONNECTED_PATTERN.test(text)) {
        currentStatus = { status: 'connected', url: `https://${tunnelHostname}`, error: null };
      }
    } else {
      const match = text.match(QUICK_TUNNEL_URL_PATTERN);
      if (match) {
        currentStatus = { status: 'connected', url: match[0], error: null };
      }
    }
  };

  proc.stdout?.on('data', onOutput);
  proc.stderr?.on('data', onOutput);

  proc.on('exit', (code) => {
    if (tunnelProcess === proc) {
      tunnelProcess = null;
      // Only overwrite a good status if this exit wasn't from an intentional restart
      // (startTunnel already reset currentStatus to 'starting' for the new process).
      if (currentStatus.status === 'connected' || currentStatus.status === 'starting') {
        currentStatus = { status: 'error', url: null, error: `cloudflared exited unexpectedly (code ${code})` };
      }
    }
  });
}

export function stopTunnel(): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
  currentStatus = { status: 'disabled', url: null, error: null };
}
