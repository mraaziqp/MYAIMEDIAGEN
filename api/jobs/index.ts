import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { rejectUnlessAuthed } from '../../src/gateway/cloudAuth.js';
import { createJob, getJobs, queryJobs, getHeartbeatStatus } from '../../src/gateway/db/store.pg.js';
import { runPreflightCheck } from '../../src/gateway/vramMonitor.js';
import { encryptData } from '../../src/gateway/cryptoUtils.js';
import { MediaType, AspectRatio } from '../../src/gateway/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;

  if (req.method === 'GET') {
    const q = req.query.q as string | undefined;
    if (q) {
      const results = await queryJobs(q);
      return res.status(200).json({ query: q, total: results.length, records: results });
    }
    const limit = Number(req.query.limit) || 50;
    const records = await getJobs(limit);
    return res.status(200).json({ total: records.length, records });
  }

  if (req.method === 'POST') {
    try {
      const {
        prompt,
        mediaType,
        aspectRatio,
        seed,
        steps,
        cfg,
        samplerName,
        referenceImage,
        referenceImageWidth,
        referenceImageHeight,
      } = req.body || {};

      const finalPrompt = prompt || 'A futuristic high-tech AI research lab with glowing hologram displays';
      const finalMediaType = (mediaType || 'image_fast') as MediaType;
      const finalAspectRatio = (aspectRatio || '16:9') as AspectRatio;

      // SVD is image-to-video, not text-to-video - same rule as the original local gateway
      // (server.ts's POST /api/generate).
      if (finalMediaType === 'video_short' && !referenceImage) {
        return res.status(400).json({
          error: 'video_short requires a reference image - upload one first via /api/upload-image.',
        });
      }

      // Best-effort fast reject using the last heartbeat's VRAM reading (may be a few
      // seconds stale). The worker still runs its own authoritative live nvidia-smi check
      // right before dispatch (vramMonitor.ts's runPreflightCheck, same function, real-time
      // data) - this is only here to fail fast with a clear message instead of silently
      // queuing a job that will just bounce off the worker's real guardrail.
      const { heartbeat } = await getHeartbeatStatus();
      if (heartbeat) {
        const preflight = runPreflightCheck(heartbeat.vramFreeMb ?? 0, finalMediaType);
        if (!preflight.passed) {
          return res.status(422).json({
            error: `OOM Pre-flight Guardrail: this model needs ${preflight.requiredFreeMb} MB free VRAM, only ${heartbeat.vramFreeMb} MB was available as of the last heartbeat.`,
            oomRisk: true,
          });
        }
      }

      const id = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const enc = encryptData(finalPrompt, process.env.ENCRYPTION_SECRET);

      const job = await createJob({
        id,
        prompt: finalPrompt,
        encryptedPrompt: enc.ciphertext,
        promptHash: enc.hash,
        modelType: finalMediaType,
        aspectRatio: finalAspectRatio,
        mediaType: finalMediaType === 'video_short' ? 'video' : 'image',
        seed: seed ? Number(seed) : Math.floor(Math.random() * 1000000000),
        steps: steps ? Number(steps) : finalMediaType === 'image_fast' ? 4 : 20,
        cfg: cfg ? Number(cfg) : finalMediaType === 'image_fast' ? 1 : 7,
        samplerName: samplerName || 'euler',
        referenceImageUrl: referenceImage || null,
        referenceImageWidth: referenceImageWidth ? Number(referenceImageWidth) : null,
        referenceImageHeight: referenceImageHeight ? Number(referenceImageHeight) : null,
        status: 'queued',
        durationMs: 0,
      });

      return res.status(200).json({ success: true, jobId: job.id, job });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to enqueue job', details: err?.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
