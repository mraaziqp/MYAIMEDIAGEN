# Local AI Media Gateway & Control Hub

A cloud-hosted dashboard (Vercel) backed by a small worker process on your own PC that drives a
local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance on an NVIDIA GPU (built and
tuned around an RTX 3060 Ti / 8GB). The dashboard, gallery, and downloads stay up all the time -
only *generating something new* requires your PC (and ComfyUI) to be on.

All GPU telemetry, generation, and storage in this app is real - there is no simulated/mocked
data path. VRAM is read directly from `nvidia-smi` on the worker; jobs are dispatched to a real
ComfyUI WebSocket/HTTP API; generation history lives in a real Postgres database, and finished
media in real Vercel Blob storage.

## Architecture

```
Browser  <--HTTPS-->  Vercel app (dashboard + /api/* serverless functions)
                              |
                        Postgres (jobs/gallery)  +  Vercel Blob (media)
                              ^
                              | outbound polling only - no inbound port on your PC
                              |
                    Local worker (worker/index.ts, runs on your PC)
                              |
                    ComfyUI (127.0.0.1:8188, unchanged)
```

The worker always initiates - it polls the cloud for queued jobs, renders, and pushes results
back. Nothing ever calls into your PC, so no port-forwarding or tunnel is needed for generation
to work; the dashboard itself just reads whatever the worker last reported.

## Prerequisites

- Node.js 20+
- An NVIDIA GPU with drivers installed (`nvidia-smi` must be on your `PATH`)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running locally (default `http://127.0.0.1:8188`)
  with checkpoints matching the built-in workflows:
  - `flux1-schnell-fp8.safetensors` (fast image)
  - `sd_xl_base_1.0_fp8.safetensors` (HD image)
  - `svd_xt_1_1.safetensors` (short video)
- A Vercel account with a Postgres integration (Neon) and a Blob store connected to this project

## Cloud deployment (one-time)

1. Install dependencies: `npm install`
2. Link and deploy the project: `vercel link`, then connect a **Postgres** integration and a
   **Blob** store to it from the Vercel dashboard's Storage tab (or `vercel blob store add`).
3. Set these environment variables on the Vercel project (dashboard → Settings → Environment
   Variables, or `vercel env add`):
   - `DATABASE_URL` - populated automatically once Postgres is connected
   - `BLOB_READ_WRITE_TOKEN` - populated automatically once Blob is connected
   - `SITE_PASSWORD` - the shared password that gates the dashboard
   - `SESSION_SECRET` - any long random string, signs the login cookie
   - `WORKER_TOKEN` - any long random string, the worker's own credential
   - `ENCRYPTION_SECRET` - any long random string, used for the vault's display-only prompt encryption
4. Deploy: `vercel --prod`
5. If you have existing history in a local `.data/gateway.sqlite3` from the legacy local server
   (see below), migrate it once: `npm run migrate:postgres` (needs `DATABASE_URL` in your local
   `.env`).

## Running the worker (on the PC with the GPU)

1. Copy `.env.example` to `.env` and fill in the **WORKER config** section: `CLOUD_API_URL`
   (your Vercel URL), `WORKER_TOKEN` (must match what you set on Vercel), `COMFYUI_URL`, and
   `BLOB_READ_WRITE_TOKEN` (same value as on Vercel).
2. Start ComfyUI locally.
3. Run the worker: `npm run worker`, or double-click `start-worker.bat` on Windows.

The worker polls the cloud every ~2s for queued jobs and posts a telemetry heartbeat every
~7s - the dashboard's **Worker Status** tab and VRAM gauge derive "online/offline" purely from
how recent that heartbeat is, never by contacting your PC directly.

## Dashboard

- **Studio Generator** - live VRAM/RAM gauges (sourced from the worker's heartbeat), the
  generation form with an optional reference image upload (required for video - see below - and
  usable as an image-to-image starting point for Flux/SDXL), and live progress (polled from the
  job's row in Postgres) with a real ETA, Download/Share on the finished result.
- **Vault Gallery** - generation history with AES-256-encrypted prompt display, searchable and
  filterable by model type, with Download/Share on every completed item - stays browsable and
  downloadable even when your PC is off, since finished media lives in Vercel Blob.
- **AI Studio Schema** - the `generate_local_media` function-calling schema for Google AI Studio,
  plus a live tester that dispatches real jobs through the same authenticated job-queue API.
- **Workflows** - inspect and download the exact ComfyUI `workflow_api.json` payload for any
  model/aspect-ratio/prompt combination.
- **Worker Status** - real telemetry and online/offline state from the worker's last heartbeat,
  plus the command to start it.

### Video generation needs a reference image

SVD (`video_short`) is image-to-video, not text-to-video - there is no workflow that produces a
video without a starting image. Upload one in the Studio Generator before selecting Quantized SVD;
the button stays disabled with a clear reason until you do.

## How it works

- `GET /api/system-stats` reads the worker's last heartbeat row from Postgres and reports it
  stale (`503`) if it's more than ~15s old - never a mocked reading, and never a live call to
  your PC (the cloud can't reach it).
- `POST /api/jobs` enqueues a row in Postgres; the worker's `GET /api/worker/next-job` polling
  loop atomically claims the oldest queued one (`FOR UPDATE SKIP LOCKED`), dispatches it to
  local ComfyUI over a real WebSocket with a 5-minute execution timeout, and reports progress
  back via `POST /api/worker/progress` - the dashboard polls `GET /api/jobs/:id` for that same
  row roughly every 1.2s. Any WebSocket drop, timeout, or ComfyUI execution error fails the job
  honestly - there are no fallback timers or simulated progress.
- An OOM pre-flight check runs twice: a best-effort one in `POST /api/jobs` using the last
  heartbeat's VRAM reading (may be a few seconds stale), and the authoritative one in the worker
  itself right before dispatch, using a live `nvidia-smi` read.
- Reference images are uploaded straight from the browser to Vercel Blob (`api/upload-image.ts`
  only issues a short-lived client-upload token); the worker downloads the resulting URL and
  re-uploads the bytes to its own local ComfyUI instance before building the workflow.
- Generated media is uploaded from the worker straight to Vercel Blob and served from there -
  real public URLs that work independent of whether your PC is on.
- The whole dashboard sits behind a shared-password gate (`SITE_PASSWORD`, checked in
  `POST /api/login`, enforced via a signed httpOnly cookie) since it's a real public URL now, not
  just something reachable on your local network. Worker-facing routes (`/api/worker/*`) use a
  separate bearer token (`WORKER_TOKEN`) instead - the site password isn't a machine credential.

## Scripts

- `npm run dev` - start the **legacy** local-only server with Vite in middleware mode (see below)
- `npm run worker` - start the local worker that polls the cloud and drives ComfyUI
- `npm run migrate:postgres` - one-time import of local SQLite history into Postgres
- `npm run build` / `npm start` - build and run the legacy local server's production bundle
- `npm run lint` - type-check with `tsc --noEmit`

## Security notes

- `.env` (worker/cloud secrets) and `.data/` (the legacy local SQLite vault) are gitignored -
  never commit them.
- Rotate `WORKER_TOKEN`, `SESSION_SECRET`, `SITE_PASSWORD`, and `ENCRYPTION_SECRET` away from any
  sample values before deploying for real.

## Legacy: local-only server (superseded)

Before the Vercel + worker split, this app ran as a single Express process on your PC
(`server.ts`), with its own SQLite vault and a Cloudflare Tunnel for remote access. That code is
still present for reference/rollback but is no longer what the dashboard talks to - the frontend
now calls the `/api/jobs`-style cloud routes exclusively. To run it anyway:

```
npm run dev
```

`start.bat` launches it (plus its own Cloudflare quick tunnel) and opens the dashboard in your
browser in one step; `stop.bat` tears it down. See `src/gateway/tunnelManager.ts` for the
optional stable-hostname tunnel config (`CLOUDFLARE_TUNNEL_NAME`/`CLOUDFLARE_TUNNEL_HOSTNAME` in
`.env`) if you go this route.
