import { spawn, ChildProcess } from 'child_process';

export interface TunnelStatus {
  status: 'disabled' | 'starting' | 'connected' | 'error';
  url: string | null;
  error: string | null;
}

// Matches the URL cloudflared prints when a quick tunnel (trycloudflare.com) comes up -
// confirmed against real cloudflared 2026.5.0 output, not guessed from docs.
const QUICK_TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

let tunnelProcess: ChildProcess | null = null;
let currentStatus: TunnelStatus = { status: 'disabled', url: null, error: null };

export function getTunnelStatus(): TunnelStatus {
  return { ...currentStatus };
}

/**
 * Spawns a Cloudflare quick tunnel (no account/domain needed) pointed at the gateway's own
 * port, so there's always a real public link to reach the dashboard even when the local
 * port isn't reachable directly (different network, port conflict, etc). The URL is
 * ephemeral - it changes every time this starts - by design of quick tunnels; there's no
 * persistent identity to configure. Non-fatal if `cloudflared` isn't installed.
 */
export function startQuickTunnel(port: number): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }

  currentStatus = { status: 'starting', url: null, error: null };

  let proc: ChildProcess;
  try {
    proc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    if (currentStatus.status !== 'connected') {
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
      // (startQuickTunnel already reset currentStatus to 'starting' for the new process).
      if (currentStatus.status === 'connected' || currentStatus.status === 'starting') {
        currentStatus = { status: 'error', url: null, error: `cloudflared exited unexpectedly (code ${code})` };
      }
    }
  });
}

export function stopQuickTunnel(): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
  currentStatus = { status: 'disabled', url: null, error: null };
}
