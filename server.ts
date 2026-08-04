// Must run before any other import - db/store.js reads process.env.* at module load time,
// so .env has to be loaded first or those values are silently ignored.
import 'dotenv/config';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import { createServer as createViteServer } from 'vite';

import {
  getGenerations,
  getGenerationById,
  getSettings,
  updateSettings,
  querySecondBrainIndex,
  getDurationStats,
} from './src/gateway/db/store.js';
import { comfyService, JobInProgressError, OomGuardrailError } from './src/gateway/comfyService.js';
import { getSystemStatsInternal, GpuTelemetryError } from './src/gateway/vramMonitor.js';
import { startQuickTunnel, stopQuickTunnel, getTunnelStatus } from './src/gateway/tunnelManager.js';
import { buildComfyWorkflow } from './src/gateway/workflowMapper.js';
import { encryptData, hashData, maskSecret } from './src/gateway/cryptoUtils.js';
import { WorkflowParams, FunctionCallPayload, MediaType, AspectRatio } from './src/types.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

/**
 * Bearer Authorization Header Middleware Validation.
 * Mounted at app.use('/api', authMiddleware) - Express strips the '/api' mount prefix from
 * req.path inside this handler, so every check below is relative to '/api', not absolute.
 */
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Open for dashboard convenience. The browser can't know a custom GATEWAY_AUTH_TOKEN set
  // directly in .env until the user re-saves it via the Settings tab, so these must stay
  // reachable without it. Interrupt/free-vram are low-severity nuisance-only actions (stop
  // or unload a render) if hit externally - strictly less sensitive than /generate, which
  // is already open. POST /settings is NOT here: it can hijack the whole gateway config.
  if (
    req.path.startsWith('/stream') ||
    req.path === '/system-stats' ||
    req.path === '/duration-stats' ||
    req.path === '/ai-studio/function-call' ||
    req.path === '/generate' ||
    req.path === '/generations' ||
    (req.path === '/settings' && req.method === 'GET') ||
    req.path === '/workflow-download' ||
    req.path === '/view' ||
    req.path === '/interrupt' ||
    req.path === '/free-vram' ||
    req.path === '/upload-image' ||
    req.path === '/tunnel-status' ||
    req.path === '/session-token' ||
    req.path === '/current-job'
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const settings = getSettings();
  const expectedToken = settings.authToken || 'sec_rtx3060ti_gateway_key_9988';

  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized: Missing Bearer Authorization header.',
      message: 'Provide a valid Bearer header matching GATEWAY_AUTH_TOKEN in settings or .env',
    });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token !== expectedToken && hashData(token) !== hashData(expectedToken)) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid Bearer Authorization Token.',
      message: 'Provide valid Bearer header matching GATEWAY_AUTH_TOKEN in settings or .env',
    });
  }

  next();
};

// Scoped to /api only - this must never gate the SPA shell or its JS/CSS assets.
app.use('/api', authMiddleware);

// ==========================================
// API ROUTES
// ==========================================

/**
 * GET /api/tunnel-status
 * Real status of the gateway-managed Cloudflare quick tunnel - a stable public link to
 * this dashboard that doesn't depend on the local port being directly reachable. The URL
 * is ephemeral (changes each time the gateway restarts) since quick tunnels have no
 * persistent identity to configure.
 */
app.get('/api/tunnel-status', (req: Request, res: Response) => {
  res.json(getTunnelStatus());
});

/**
 * GET /api/current-job
 * Real in-flight promptId (or null), read straight from ComfyService's single-slot job
 * tracker. Lets the dashboard reattach its live progress view after a page refresh instead
 * of just losing track of a generation that is still genuinely running on the GPU.
 */
app.get('/api/current-job', (req: Request, res: Response) => {
  res.json({ activePromptId: comfyService.getCurrentPromptId() });
});

/**
 * GET /api/session-token
 * Lets the dashboard auto-authenticate itself for protected actions (Settings) without the
 * user ever having to know or paste the token - but ONLY for requests that are genuinely
 * local. A raw loopback IP check isn't sufficient: the Cloudflare tunnel itself connects to
 * this server over 127.0.0.1, so a tunneled visitor's request also arrives with ip=127.0.0.1.
 * Real tunnel traffic is distinguishable by the cf-* headers Cloudflare's edge always injects
 * (confirmed empirically, not assumed) - their absence means the request reached this server
 * directly, without going through the public tunnel.
 */
app.get('/api/session-token', (req: Request, res: Response) => {
  const isLoopback = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const cameThroughTunnel = Boolean(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);

  if (!isLoopback || cameThroughTunnel) {
    return res.status(403).json({ error: 'Session token is only issued to genuinely local requests.' });
  }

  const settings = getSettings();
  res.json({ token: settings.authToken });
});

/**
 * GET /api/system-stats
 * OOM Pre-flight check & system VRAM stats for RTX 3060 Ti
 */
app.get('/api/system-stats', async (req: Request, res: Response) => {
  try {
    const settings = getSettings();
    const stats = await getSystemStatsInternal(settings.comfyUrl);
    res.json(stats);
  } catch (err: any) {
    if (err instanceof GpuTelemetryError) {
      return res.status(503).json({
        error: 'GPU telemetry unavailable',
        details: err.message,
      });
    }
    res.status(500).json({ error: 'Failed to fetch system stats', details: err?.message });
  }
});

/**
 * GET /api/duration-stats
 * Real average render duration per model, computed from the last 20 completed jobs actually
 * recorded in SQLite - never a hardcoded estimate. A model with no completed runs yet reports
 * avgDurationMs: null so the UI can say "No data yet" instead of guessing.
 */
app.get('/api/duration-stats', (req: Request, res: Response) => {
  try {
    res.json({ stats: getDurationStats() });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to compute duration stats', details: err?.message });
  }
});

/**
 * GET /api/view
 * Proxies generated image/video bytes from ComfyUI through the gateway's own origin.
 * Required for the browser's `download` attribute and Web Share API's fetch() to work
 * (both are blocked cross-origin, and ComfyUI has CORS disabled by default), and for
 * media to be viewable at all when the dashboard is accessed remotely through a tunnel -
 * a raw ComfyUI URL like http://127.0.0.1:8188/... resolves to the *visitor's* machine.
 */
app.get('/api/view', async (req: Request, res: Response) => {
  try {
    const filename = req.query.filename as string;
    const subfolder = (req.query.subfolder as string) || '';
    const type = (req.query.type as string) || 'output';

    if (!filename) {
      return res.status(400).json({ error: 'Missing filename parameter' });
    }

    const settings = getSettings();
    const cleanUrl = settings.comfyUrl.replace(/\/$/, '');
    const targetUrl = `${cleanUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(
      subfolder
    )}&type=${encodeURIComponent(type)}`;

    const comfyRes = await fetch(targetUrl);
    if (!comfyRes.ok) {
      return res.status(comfyRes.status).json({ error: 'Media not found on ComfyUI' });
    }

    res.setHeader('Content-Type', comfyRes.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    const arrayBuffer = await comfyRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to proxy media from ComfyUI', details: err?.message });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * POST /api/upload-image
 * Proxies a reference image to ComfyUI's real /upload/image endpoint (confirmed against
 * ComfyUI's own server.py - expects multipart field "image", type "input" so LoadImage
 * nodes can find it). Returns the ComfyUI-side filename to pass back into /api/generate.
 */
app.post('/api/upload-image', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided (expected multipart field "image")' });
    }

    const settings = getSettings();
    const cleanUrl = settings.comfyUrl.replace(/\/$/, '');

    const form = new FormData();
    form.append('image', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    form.append('type', 'input');
    form.append('overwrite', 'true');

    const comfyRes = await fetch(`${cleanUrl}/upload/image`, { method: 'POST', body: form });
    if (!comfyRes.ok) {
      const errText = await comfyRes.text();
      return res.status(comfyRes.status).json({ error: 'ComfyUI rejected the upload', details: errText });
    }

    const data = (await comfyRes.json()) as { name: string; subfolder: string; type: string };

    // Real pixel dimensions, read from the same bytes just uploaded - the face-preserving
    // scene-swap workflow (see workflowMapper.ts) needs these to size the generated
    // background to exactly match the source photo for a pixel-accurate composite.
    const metadata = await sharp(req.file.buffer).metadata();

    res.json({
      success: true,
      filename: data.name,
      subfolder: data.subfolder,
      type: data.type,
      width: metadata.width,
      height: metadata.height,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to upload image to ComfyUI', details: err?.message });
  }
});

/**
 * POST /api/generate
 * Dynamic workflow selector for image_fast (Flux FP8), image_hd (SDXL FP8), video_short (SVD)
 */
app.post('/api/generate', async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      media_type,
      mediaType,
      aspect_ratio,
      aspectRatio,
      seed,
      steps,
      cfg,
      negativePrompt,
      referenceImage,
      referenceImageWidth,
      referenceImageHeight,
    } = req.body;

    const finalPrompt = prompt || 'A futuristic high-tech AI research lab with glowing hologram displays';
    const finalMediaType: MediaType = (media_type || mediaType || 'image_fast') as MediaType;
    const finalAspectRatio: AspectRatio = (aspect_ratio || aspectRatio || '16:9') as AspectRatio;

    // SVD is fundamentally image-to-video, not text-to-video - there is no workflow path
    // that produces a video without a starting image, so reject early with a clear reason
    // rather than letting ComfyUI fail on a workflow with no image input.
    if (finalMediaType === 'video_short' && !referenceImage) {
      return res.status(400).json({
        error: 'video_short requires a reference image - upload one first via /api/upload-image, then pass its filename as referenceImage.',
      });
    }

    const params: WorkflowParams = {
      prompt: finalPrompt,
      mediaType: finalMediaType,
      aspectRatio: finalAspectRatio,
      seed: seed ? Number(seed) : undefined,
      steps: steps ? Number(steps) : undefined,
      cfg: cfg ? Number(cfg) : undefined,
      negativePrompt,
      referenceImage: referenceImage || undefined,
      referenceImageWidth: referenceImageWidth ? Number(referenceImageWidth) : undefined,
      referenceImageHeight: referenceImageHeight ? Number(referenceImageHeight) : undefined,
    };

    const result = await comfyService.queueGeneration(params);

    res.json({
      success: true,
      promptId: result.promptId,
      status: result.generation.status,
      mediaType: finalMediaType,
      aspectRatio: finalAspectRatio,
      warnings: result.warnings,
      preflightPassed: result.preflightPassed,
      generation: result.generation,
      sseStreamUrl: `/api/stream/${result.promptId}`,
    });
  } catch (err: any) {
    console.error('[API /api/generate Error]:', err);
    if (err instanceof JobInProgressError) {
      return res.status(409).json({ error: err.message, activePromptId: err.activePromptId });
    }
    if (err instanceof OomGuardrailError) {
      return res.status(422).json({
        error: err.message,
        oomRisk: true,
        vramFreeMb: err.vramFreeMb,
        requiredFreeMb: err.requiredFreeMb,
      });
    }
    res.status(500).json({ error: 'Generation trigger failed', details: err?.message });
  }
});

/**
 * GET /api/stream/:promptId
 * Real-Time Server-Sent Events (SSE) Route piping ComfyUI progress
 */
app.get('/api/stream/:promptId', (req: Request, res: Response) => {
  const promptId = req.params.promptId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', promptId })}\n\n`);

  const listener = (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.status === 'completed' || event.status === 'failed' || event.status === 'interrupted') {
      setTimeout(() => res.end(), 1000);
    }
  };

  comfyService.registerStreamListener(promptId, listener);

  req.on('close', () => {
    comfyService.removeStreamListener(promptId);
  });
});

/**
 * POST /api/interrupt
 * Immediately halts ComfyUI GPU execution
 */
app.post('/api/interrupt', async (req: Request, res: Response) => {
  try {
    const settings = getSettings();
    const success = await comfyService.interruptCurrentTask(settings.comfyUrl);
    res.json({ success, message: 'GPU execution interrupted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to interrupt GPU execution', details: err?.message });
  }
});

/**
 * POST /api/free-vram
 * Unloads models from ComfyUI and frees the VRAM/RAM cache (real ComfyUI /free API).
 * Refused with 409 while a job is actively executing.
 */
app.post('/api/free-vram', async (req: Request, res: Response) => {
  try {
    const settings = getSettings();
    await comfyService.freeVram(settings.comfyUrl);

    // ComfyUI's /free just sets a flag - its worker thread unloads models and runs CUDA's
    // cache-release asynchronously, which takes a few seconds. Poll briefly so the response
    // reflects VRAM actually being free rather than a stale, barely-changed reading.
    let stats = await getSystemStatsInternal(settings.comfyUrl);
    let previousFree = stats.vramFreeMb;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      stats = await getSystemStatsInternal(settings.comfyUrl);
      if (stats.vramFreeMb <= previousFree) break; // stabilized
      previousFree = stats.vramFreeMb;
    }

    res.json({ success: true, message: 'ComfyUI VRAM freed.', stats });
  } catch (err: any) {
    if (err instanceof JobInProgressError) {
      return res.status(409).json({ error: err.message, activePromptId: err.activePromptId });
    }
    res.status(500).json({ error: 'Failed to free VRAM', details: err?.message });
  }
});

/**
 * GET /api/generations
 * Lists local generation records with encrypted prompt/path support and Second Brain search
 */
app.get('/api/generations', (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (query) {
      const results = querySecondBrainIndex(query);
      return res.json({ query, total: results.length, records: results });
    }
    const limit = Number(req.query.limit) || 50;
    const records = getGenerations(limit);
    res.json({ total: records.length, records });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve generations', details: err?.message });
  }
});

/**
 * GET /api/settings
 * POST /api/settings
 * Settings management for ComfyUI URL, Bearer Auth, and Encryption Secret Key
 */
app.get('/api/settings', (req: Request, res: Response) => {
  const settings = getSettings();
  res.json({
    comfyUrl: settings.comfyUrl,
    autoOomCheck: settings.autoOomCheck,
    vramThresholdMb: settings.vramThresholdMb,
    maskedAuthToken: maskSecret(settings.authToken),
    authTokenHash: hashData(settings.authToken),
    maskedEncryptionSecret: maskSecret(settings.encryptionSecret),
  });
});

app.post('/api/settings', (req: Request, res: Response) => {
  try {
    const { comfyUrl, authToken, encryptionSecret, autoOomCheck, vramThresholdMb } = req.body;

    const updated = updateSettings({
      ...(comfyUrl !== undefined && { comfyUrl }),
      ...(authToken !== undefined && authToken.trim() !== '' && { authToken }),
      ...(encryptionSecret !== undefined && encryptionSecret.trim() !== '' && { encryptionSecret }),
      ...(autoOomCheck !== undefined && { autoOomCheck }),
      ...(vramThresholdMb !== undefined && { vramThresholdMb: Number(vramThresholdMb) }),
    });

    res.json({
      success: true,
      message: 'Gateway settings updated successfully.',
      comfyUrl: updated.comfyUrl,
      authTokenHash: hashData(updated.authToken),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update settings', details: err?.message });
  }
});

/**
 * POST /api/ai-studio/function-call
 * Executes function calls matching Google AI Studio Tool declaration `generate_local_media`
 */
app.post('/api/ai-studio/function-call', async (req: Request, res: Response) => {
  try {
    const { name, args } = req.body;

    if (name !== 'generate_local_media' && name !== 'generate_media') {
      return res.status(400).json({
        error: `Unknown function name: ${name}. Supported tool function: 'generate_local_media'`,
      });
    }

    const payload: FunctionCallPayload = args || req.body;
    const mediaType: MediaType = (payload.media_type || 'image_fast') as MediaType;
    const aspectRatio: AspectRatio = (payload.aspect_ratio || '16:9') as AspectRatio;
    const referenceImage = payload.reference_image || payload.referenceImage;

    if (mediaType === 'video_short' && !referenceImage) {
      return res.status(400).json({
        error: 'video_short requires reference_image - SVD is image-to-video, not text-to-video. Upload an image via /api/upload-image first and pass its filename as reference_image.',
      });
    }

    const result = await comfyService.queueGeneration({
      prompt: payload.prompt,
      mediaType,
      aspectRatio,
      seed: payload.seed,
      referenceImage,
    });

    res.json({
      function_name: 'generate_local_media',
      status: 'SUCCESS',
      prompt_id: result.promptId,
      media_type: mediaType,
      aspect_ratio: aspectRatio,
      vram_preflight_passed: result.preflightPassed,
      warnings: result.warnings,
      sse_stream_url: `/api/stream/${result.promptId}`,
      media_url: result.generation.mediaUrl,
      message: `Triggered RTX 3060 Ti ComfyUI rendering for '${payload.prompt.slice(0, 40)}...'`,
    });
  } catch (err: any) {
    if (err instanceof JobInProgressError) {
      return res.status(409).json({ error: err.message, activePromptId: err.activePromptId });
    }
    if (err instanceof OomGuardrailError) {
      return res.status(422).json({
        error: err.message,
        oomRisk: true,
        vramFreeMb: err.vramFreeMb,
        requiredFreeMb: err.requiredFreeMb,
      });
    }
    res.status(500).json({ error: 'AI Studio function call failed', details: err?.message });
  }
});

/**
 * GET /api/workflow-download
 * Returns standard workflow_api.json for local ComfyUI drag-and-drop import
 */
app.get('/api/workflow-download', (req: Request, res: Response) => {
  try {
    const mediaType = (req.query.mediaType as MediaType) || 'image_fast';
    const aspectRatio = (req.query.aspectRatio as AspectRatio) || '16:9';
    const prompt = (req.query.prompt as string) || 'Cyberpunk neon city street with reflections';
    // SVD has no text-to-video path; this is a static JSON export for reference/import, so
    // illustrate the correct shape with a placeholder rather than erroring on video_short.
    const referenceImage =
      (req.query.referenceImage as string) ||
      (mediaType === 'video_short' ? 'PLACEHOLDER_upload_in_Studio_Generator.png' : undefined);

    const { workflow } = buildComfyWorkflow({ prompt, mediaType, aspectRatio, referenceImage });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="workflow_${mediaType}_api.json"`);
    res.json(workflow);
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to build workflow', details: err?.message });
  }
});

// ==========================================
// VITE MIDDLEWARE & STATIC SERVING
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`  Local AI Media Gateway running on http://0.0.0.0:${PORT}`);
    console.log(`  RTX 3060 Ti ComfyUI Connector & SSE Controller`);
    console.log(`====================================================`);
    startQuickTunnel(PORT);
  });
}

startServer();

process.on('SIGINT', () => {
  stopQuickTunnel();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopQuickTunnel();
  process.exit(0);
});
