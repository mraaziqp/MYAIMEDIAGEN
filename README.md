# Local AI Media Gateway & Control Hub

A hybrid cloud-to-local media generation platform: an Express gateway on your PC that drives a
local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance on an NVIDIA GPU (built and
tuned around an RTX 3060 Ti / 8GB), with a React dashboard for generating, tracking, and vaulting
images and short videos, plus a Google AI Studio function-calling adapter so an AI agent can
trigger renders on your machine.

All GPU telemetry, generation, and storage in this app is real - there is no simulated/mocked
data path. VRAM is read directly from `nvidia-smi`; jobs are dispatched to a real ComfyUI
WebSocket/HTTP API; generation history is stored in a real SQLite database via Drizzle ORM.

## Prerequisites

- Node.js 20+
- An NVIDIA GPU with drivers installed (`nvidia-smi` must be on your `PATH`)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running locally (default `http://127.0.0.1:8188`)
  with checkpoints matching the built-in workflows:
  - `flux1-schnell-fp8.safetensors` (fast image)
  - `sd_xl_base_1.0_fp8.safetensors` (HD image)
  - `svd_xt_1_1.safetensors` (short video)

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and adjust as needed:
   ```
   COMFYUI_URL="http://127.0.0.1:8188"
   GATEWAY_AUTH_TOKEN="<pick your own bearer token>"
   ENCRYPTION_SECRET="<pick your own AES-256 key>"
   PORT=3000
   ```
   Always change `GATEWAY_AUTH_TOKEN` and `ENCRYPTION_SECRET` from the sample values before
   exposing this gateway beyond localhost.
3. Start ComfyUI on your GPU machine.
4. Run the gateway:
   ```
   npm run dev
   ```
5. Open `http://localhost:3000`.

On Windows, `start.bat` launches the gateway, opens a Cloudflare tunnel (requires `cloudflared`
installed separately), and opens the dashboard in your browser in one step; `stop.bat` tears it
all down.

## Dashboard

- **Studio Generator** - live VRAM/RAM gauges (from `nvidia-smi`, refreshed every 6s), the
  generation form, and real-time SSE progress for the active job.
- **Vault Gallery** - AES-256-encrypted generation history, searchable and filterable by model type.
- **AI Studio Schema** - the `generate_local_media` function-calling schema for Google AI Studio,
  plus a live tester that dispatches real jobs through the same gateway API.
- **Workflows** - inspect and download the exact ComfyUI `workflow_api.json` payload for any
  model/aspect-ratio/prompt combination.
- **Tunnel Config** - configure the ComfyUI URL, bearer token, and encryption secret; test the
  ComfyUI connection.

## How it works

- `GET /api/system-stats` shells out to `nvidia-smi` for exact VRAM figures and reads host RAM
  via Node's `os` module. If `nvidia-smi` can't be read, it returns `503` - never a mocked reading.
- `POST /api/generate` and the AI Studio function-call route both go through a single job queue
  (one GPU, one job at a time - a second request while one is running gets `409`), enforce an
  OOM pre-flight guardrail (`422` if free VRAM is below what the selected model needs), and open
  a real WebSocket to ComfyUI with a 5-minute execution timeout. Any WebSocket drop, timeout, or
  ComfyUI execution error fails the job and reports it over SSE - there are no fallback timers or
  simulated progress.
- Generation records live in a real SQLite database (`.data/gateway.sqlite3`, via
  `drizzle-orm/better-sqlite3`), with prompts and file paths AES-256-GCM encrypted.
- `/api` routes are protected by a Bearer token (`GATEWAY_AUTH_TOKEN`); the handful of read-only
  routes the dashboard needs on load stay open, everything else requires the header.

## Scripts

- `npm run dev` - start the gateway with Vite in middleware mode (hot reload)
- `npm run build` - build the frontend and bundle the server for production
- `npm start` - run the production build (`dist/server.cjs`)
- `npm run lint` - type-check with `tsc --noEmit`

## Security notes

- `.data/` (SQLite vault, settings with your bearer token and encryption secret) is gitignored -
  never commit it.
- If you tunnel this gateway to the public internet (e.g. via `start.bat`/Cloudflare), make sure
  `GATEWAY_AUTH_TOKEN` and `ENCRYPTION_SECRET` are changed from the sample defaults first.
