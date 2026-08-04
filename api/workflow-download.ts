import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectUnlessAuthed } from '../src/gateway/cloudAuth.js';
import { buildComfyWorkflow } from '../src/gateway/workflowMapper.js';
import { MediaType, AspectRatio } from '../src/gateway/types.js';

/** Same static JSON-export tool as the old local gateway's route - pure logic, no I/O, so
 *  buildComfyWorkflow ports over unchanged. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;

  try {
    const mediaType = (req.query.mediaType as MediaType) || 'image_fast';
    const aspectRatio = (req.query.aspectRatio as AspectRatio) || '16:9';
    const prompt = (req.query.prompt as string) || 'Cyberpunk neon city street with reflections';
    const referenceImage =
      (req.query.referenceImage as string) ||
      (mediaType === 'video_short' ? 'PLACEHOLDER_upload_in_Studio_Generator.png' : undefined);

    const { workflow } = buildComfyWorkflow({ prompt, mediaType, aspectRatio, referenceImage });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="workflow_${mediaType}_api.json"`);
    res.status(200).json(workflow);
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to build workflow', details: err?.message });
  }
}
