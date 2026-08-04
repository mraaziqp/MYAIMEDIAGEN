import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { rejectUnlessAuthed } from '../src/gateway/cloudAuth.js';

/**
 * Generates a short-lived client-upload token so the browser uploads reference-image bytes
 * straight to Vercel Blob, not through this function - a serverless function's request body
 * is capped well below what a phone photo can be, and there's no ComfyUI involved at this
 * layer at all (the worker downloads the resulting Blob URL and re-uploads to its own local
 * ComfyUI instance before dispatch - see worker/runJob.ts).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectUnlessAuthed(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req as unknown as Request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        addRandomSuffix: true,
        maximumSizeInBytes: 25 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {
        // No bookkeeping needed here - the resulting Blob URL is attached to a job directly
        // by the client when it calls POST /api/jobs.
      },
    });
    res.status(200).json(jsonResponse);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Upload failed' });
  }
}
