import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../src/gateway/cloudAuth.js';
import { requestFreeVram, getHeartbeatStatus } from '../src/gateway/db/store.pg.js';

/**
 * POST /api/free-vram
 * Cloud serverless endpoint: requests the worker to unload models from ComfyUI and
 * free PyTorch CUDA memory cache. Refused if a render is currently running.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await requestFreeVram();
    if (!result.accepted) {
      return res.status(409).json({ error: result.reason || 'Cannot free VRAM right now.' });
    }

    const { online } = await getHeartbeatStatus();
    return res.status(200).json({
      success: true,
      message: online
        ? 'VRAM purge requested - your local worker is unloading models and clearing GPU cache.'
        : 'VRAM purge requested (worker offline - will apply upon connection).',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to request VRAM free', details: err?.message });
  }
}
