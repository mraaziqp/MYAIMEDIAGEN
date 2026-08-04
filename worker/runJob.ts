import WebSocket from 'ws';
import crypto from 'crypto';
import { put } from '@vercel/blob';
import { buildComfyUiWorkflow } from '../src/gateway/workflowMapper.js';
import { getSystemStatsInternal, runPreflightCheck } from '../src/gateway/vramMonitor.js';
import { MediaType } from '../src/gateway/types.js';
import type { Job } from '../src/gateway/db/schema.pg.js';
import * as cloud from './gatewayClient.js';

const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Reference images arrive as a Blob URL on the job (uploaded straight from the browser to
 * Vercel Blob - see api/upload-image.ts) - ComfyUI's LoadImage node needs a filename already
 * sitting in its own local input/ directory, so this downloads the bytes and re-uploads them
 * to the local ComfyUI instance exactly the way the old comfyService.ts's multer-backed
 * /api/upload-image used to, just sourced from Blob instead of a direct browser upload.
 */
async function uploadReferenceImageToComfy(blobUrl: string, comfyUrl: string): Promise<string> {
  const imgRes = await fetch(blobUrl);
  if (!imgRes.ok) throw new Error(`Failed to download reference image from Blob storage: HTTP ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get('content-type') || 'image/png';

  const form = new FormData();
  form.append('image', new Blob([buffer], { type: contentType }), 'reference.png');
  form.append('type', 'input');
  form.append('overwrite', 'true');

  const cleanUrl = comfyUrl.replace(/\/$/, '');
  const uploadRes = await fetch(`${cleanUrl}/upload/image`, { method: 'POST', body: form });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`ComfyUI rejected the reference image upload: HTTP ${uploadRes.status}: ${errText}`);
  }
  const data = (await uploadRes.json()) as { name: string };
  return data.name;
}

/**
 * Drives one job end-to-end against local ComfyUI - real WebSocket dispatch, real progress
 * math (same ETA approach as the original comfyService.ts: historical-average during model
 * load isn't available here since the worker doesn't hold job history, so this phase reports
 * elapsed only; live step-rate extrapolation during denoising, identical to the local
 * gateway), real Blob upload of the result. No fallback/simulated progress paths - any
 * failure reports honestly via cloud.postFail rather than silently retrying or faking success.
 */
export async function runJob(job: Job, comfyUrl: string): Promise<void> {
  const startTime = Date.now();

  // Authoritative live check right before dispatch - api/jobs/index.ts already did a
  // best-effort pass using the last heartbeat, which can be a few seconds stale.
  const stats = await getSystemStatsInternal(comfyUrl);
  const preflight = runPreflightCheck(stats.vramFreeMb, job.modelType as MediaType);
  if (!preflight.passed) {
    await cloud.postFail(
      job.id,
      `OOM Pre-flight Guardrail: this model needs ${preflight.requiredFreeMb} MB free VRAM, only ${stats.vramFreeMb} MB is available.`
    );
    return;
  }

  let referenceImageFilename: string | undefined;
  if (job.referenceImageUrl) {
    try {
      referenceImageFilename = await uploadReferenceImageToComfy(job.referenceImageUrl, comfyUrl);
    } catch (err: any) {
      await cloud.postFail(job.id, err?.message || 'Failed to prepare reference image');
      return;
    }
  }

  const workflow = buildComfyUiWorkflow({
    prompt: job.prompt,
    modelType: job.modelType as any,
    mediaType: job.modelType as MediaType,
    aspectRatio: job.aspectRatio as any,
    seed: job.seed,
    steps: job.steps,
    cfg: job.cfg,
    samplerName: job.samplerName,
    referenceImage: referenceImageFilename,
    referenceImageWidth: job.referenceImageWidth ?? undefined,
    referenceImageHeight: job.referenceImageHeight ?? undefined,
  });

  const cleanUrl = comfyUrl.replace(/\/$/, '');
  const clientId = `worker_${crypto.randomUUID().slice(0, 8)}`;
  const wsUrl = cleanUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;

  await new Promise<void>((resolve) => {
    let settled = false;
    let samplingStartTime: number | null = null;
    let peakVramMb = stats.vramUsedMb;

    // Chains fn()'s own promise (if it returns one) into the outer resolve - callers don't
    // need to await finalize() themselves, but runJob's promise still won't settle until any
    // async cleanup (e.g. the Blob upload on success) actually finishes.
    const finalize = (fn: () => void | Promise<void>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      Promise.resolve()
        .then(fn)
        .catch((err) => console.error(`[worker] finalize handler for job ${job.id} threw:`, err))
        .finally(resolve);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err: any) {
      finalize(() => cloud.postFail(job.id, err?.message || `Failed to open WebSocket to ${wsUrl}`, false));
      return;
    }

    const timeoutHandle = setTimeout(() => {
      finalize(async () => {
        await cloud.postFail(job.id, `GPU execution timed out after 5 minutes with no 'executed' event from ComfyUI.`);
        try {
          ws.close();
        } catch {}
        fetch(`${cleanUrl}/interrupt`, { method: 'POST' }).catch(() => {});
      });
    }, EXECUTION_TIMEOUT_MS);

    ws.on('open', async () => {
      try {
        const res = await fetch(`${cleanUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`ComfyUI returned HTTP ${res.status}: ${errText}`);
        }
      } catch (err: any) {
        finalize(() => {
          ws.close();
          return cloud.postFail(job.id, err?.message || 'Failed to submit workflow to ComfyUI');
        });
      }
    });

    ws.on('message', async (data: WebSocket.RawData) => {
      if (settled) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'executing') {
          const nodeId = msg.data.node;
          if (nodeId !== null) {
            const isModelLoad = nodeId === '1';
            const elapsedMs = Date.now() - startTime;
            let vramCurrentMb: number | undefined;
            try {
              const liveStats = await getSystemStatsInternal(comfyUrl);
              vramCurrentMb = liveStats.vramUsedMb;
              peakVramMb = Math.max(peakVramMb, liveStats.vramUsedMb);
            } catch {
              // Telemetry is best-effort mid-run; the progress report still carries honest
              // status text and elapsed time even if this particular read fails.
            }

            const { interruptRequested } = await cloud
              .postProgress(job.id, {
                percentage: isModelLoad ? 5 : 15,
                node: `Node_${nodeId}`,
                nodeTitle: isModelLoad
                  ? `Streaming model weights into VRAM - ${Math.round(elapsedMs / 1000)}s elapsed`
                  : `Preparing Node ${nodeId} - ${Math.round(elapsedMs / 1000)}s elapsed`,
                vramCurrentMb,
                elapsedMs,
              })
              .catch(() => ({ interruptRequested: false }));

            if (interruptRequested) {
              finalize(async () => {
                ws.close();
                fetch(`${cleanUrl}/interrupt`, { method: 'POST' }).catch(() => {});
                await cloud.postFail(job.id, 'Generation interrupted by user request.', true);
              });
            }
          }
        } else if (msg.type === 'progress') {
          const { value, max } = msg.data;
          const elapsedMs = Date.now() - startTime;
          if (samplingStartTime === null) samplingStartTime = Date.now();

          let etaSeconds: number | undefined;
          if (value > 0) {
            const msPerStep = (Date.now() - samplingStartTime) / value;
            etaSeconds = Math.max(0, Math.round((msPerStep * (max - value)) / 1000));
          }

          const { interruptRequested } = await cloud
            .postProgress(job.id, {
              percentage: Math.round((value / max) * 100),
              step: value,
              maxSteps: max,
              node: 'KSampler',
              nodeTitle: 'Denoising Latents',
              elapsedMs,
              etaSeconds,
            })
            .catch(() => ({ interruptRequested: false }));

          if (interruptRequested) {
            finalize(async () => {
              ws.close();
              fetch(`${cleanUrl}/interrupt`, { method: 'POST' }).catch(() => {});
              await cloud.postFail(job.id, 'Generation interrupted by user request.', true);
            });
          }
        } else if (msg.type === 'executed') {
          const output = msg.data.output;
          let filename = '';
          let subfolder = '';
          let type = 'output';

          if (output?.images?.length) {
            filename = output.images[0].filename;
            subfolder = output.images[0].subfolder || '';
            type = output.images[0].type || 'output';
          } else if (output?.animated?.length) {
            filename = output.animated[0].filename;
            subfolder = output.animated[0].subfolder || '';
          } else if (output?.gifs?.length) {
            filename = output.gifs[0].filename;
            subfolder = output.gifs[0].subfolder || '';
          }

          if (filename) {
            finalize(async () => {
              try {
                const viewUrl = `${cleanUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(
                  subfolder
                )}&type=${type}`;
                const mediaRes = await fetch(viewUrl);
                if (!mediaRes.ok) throw new Error(`Failed to fetch generated media from ComfyUI: HTTP ${mediaRes.status}`);
                const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
                const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';

                const blob = await put(`generations/${job.id}-${filename}`, mediaBuffer, {
                  access: 'public',
                  contentType,
                  token: process.env.BLOB_READ_WRITE_TOKEN,
                });

                const durationMs = Date.now() - startTime;
                await cloud.postComplete(job.id, { mediaUrl: blob.url, durationMs, vramPeakMb: peakVramMb });
              } catch (err: any) {
                await cloud.postFail(job.id, err?.message || 'Failed to upload generated media to Blob storage');
              } finally {
                ws.close();
              }
            });
          }
        } else if (msg.type === 'execution_error') {
          const errDetail = msg.data?.exception_message || msg.data?.exception_type || 'ComfyUI execution error';
          finalize(() => {
            ws.close();
            return cloud.postFail(job.id, errDetail);
          });
        }
      } catch {
        // ignore malformed WS frames
      }
    });

    ws.on('error', (err) => {
      finalize(() => cloud.postFail(job.id, `ComfyUI WebSocket error: ${err.message}`));
    });

    ws.on('close', (code) => {
      finalize(() =>
        cloud.postFail(
          job.id,
          `ComfyUI WebSocket connection dropped unexpectedly before the job completed (close code ${code}).`
        )
      );
    });
  });
}
