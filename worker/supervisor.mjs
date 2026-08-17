/**
 * Keeps the worker process alive.
 *
 * The worker itself now survives internal errors, but nothing brought it back if the process
 * died outright - an OOM kill, a driver hiccup, a terminal being closed, or a reboot. That is
 * how the gateway ended up reporting "GPU telemetry offline" for 15 hours with ComfyUI running
 * happily the whole time: ComfyUI never talks to the cloud, only this process does.
 *
 * Restarts use exponential backoff so a genuinely broken config (bad WORKER_TOKEN, missing .env)
 * does not become a hot restart loop hammering the API, but a transient crash is back within
 * seconds. The backoff resets once a run has lasted long enough to count as healthy.
 *
 *   node worker/supervisor.mjs
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

// tsx's real CLI entry (its package.json "bin"). Checked up front so a missing install fails
// with a clear instruction instead of an opaque spawn error on every restart attempt.
const TSX_CLI = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!fs.existsSync(TSX_CLI)) {
  console.error(`[supervisor] Cannot find tsx at ${TSX_CLI} - run "npm install" in ${projectRoot} first.`);
  process.exit(1);
}

const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
// A run that lasts this long is treated as healthy, so the next crash starts from the floor.
const HEALTHY_RUN_MS = 60_000;

let backoffMs = MIN_BACKOFF_MS;
let stopping = false;
let child = null;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function start() {
  const startedAt = Date.now();
  console.log(`[supervisor ${ts()}] starting worker`);

  // Spawned as `node <tsx-cli> worker/index.ts` with NO shell. Going through `npx` needed
  // shell:true on Windows, which Node warns about (DEP0190: args are concatenated, not escaped)
  // and which added a redundant npx process in the tree. Invoking tsx's own CLI entry directly
  // is both quieter and one process leaner, and needs no PATH lookup.
  child = spawn(process.execPath, [TSX_CLI, path.join('worker', 'index.ts')], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;

    const ranForMs = Date.now() - startedAt;
    if (ranForMs >= HEALTHY_RUN_MS) backoffMs = MIN_BACKOFF_MS;

    console.error(
      `[supervisor ${ts()}] worker exited (code=${code} signal=${signal ?? 'none'}) after ${Math.round(
        ranForMs / 1000
      )}s - restarting in ${backoffMs / 1000}s`
    );

    setTimeout(start, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  });

  child.on('error', (err) => {
    console.error(`[supervisor ${ts()}] failed to spawn worker:`, err);
  });
}

// Pass shutdown through rather than orphaning the child.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    console.log(`[supervisor ${ts()}] ${sig} - shutting down worker`);
    if (child) child.kill();
    process.exit(0);
  });
}

start();
