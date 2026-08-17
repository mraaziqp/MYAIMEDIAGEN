import WebSocket from 'ws';
import crypto from 'crypto';
import { put } from '@vercel/blob';
import { buildComfyUiWorkflow } from '../src/gateway/workflowMapper.js';
import { getSystemStatsInternal, readGpuVram, noteVramPurged, runPreflightCheck } from '../src/gateway/vramMonitor.js';
import { MediaType } from '../src/gateway/types.js';
import * as cloud from './gatewayClient.js';
import type { ClaimedJob, JobPhase, ProgressPatch } from './gatewayClient.js';

/**
 * Timeouts are measured from the last sign of life, NOT from job start.
 *
 * A fixed wall-clock budget kills renders that are working perfectly: SDXL on this 8 GB card
 * was traced at 497s end-to-end, of which the sampler spent ~360s loading weights before its
 * first step - so a 5-minute budget failed it outright and 10 minutes was marginal. Meanwhile
 * a genuinely hung ComfyUI is not distinguishable by total runtime at all, only by silence.
 *
 * The largest gap between messages observed during that healthy-but-slow stretch was ~185s, so
 * a 6-minute silence window leaves generous headroom over real behaviour while still catching a
 * wedged process. ABSOLUTE_TIMEOUT_MS is only a backstop against a job that keeps chattering
 * forever without ever finishing.
 */
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 45 * 60 * 1000;

// Cadence of the progress ticker. Faster than the dashboard's own ~1.2s poll would be wasted
// writes; much slower and the "elapsed" readout visibly stutters. 2s also bounds how long an
// Interrupt can sit unnoticed, since the flag comes back on this same round trip.
const PROGRESS_TICK_MS = 2000;

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
 * ComfyUI answers a workflow that references an uninstalled model with an opaque HTTP 400
 * validation blob, which used to land in the dashboard verbatim as the job's error text.
 * Asking ComfyUI for its own checkpoint list first turns that into a message naming the
 * missing file. Returns null (rather than an empty list) if the introspection call itself
 * fails, so a job is never blocked on a check that couldn't be made.
 */
async function listInstalledCheckpoints(cleanUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${cleanUrl}/object_info/CheckpointLoaderSimple`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const names = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    return Array.isArray(names) ? names : null;
  } catch {
    return null;
  }
}

/**
 * Percentage bands per phase. Each phase owns a disjoint slice of 0-100 so the bar only ever
 * moves forward and a given reading always means the same thing. The old scheme reported a
 * flat 5%/15% for everything outside the sampler, which is why a 233s Flux render sat at 15%
 * for ~200s and then crossed 15->100 in the ~10s the sampler was actually running: the bar was
 * tracking graph position, not work done.
 */
const PHASE_BANDS: Record<JobPhase, [number, number]> = {
  preparing: [0, 3],
  loading: [3, 40],
  sampling: [40, 90],
  decoding: [90, 95],
  saving: [95, 97],
  uploading: [97, 99],
};

/**
 * ComfyUI identifies the running node only by its graph id ("7"), which surfaced in the UI as
 * "Preparing Node 7". We built the graph, so the id can be resolved back to its class_type and
 * named in terms of what it is doing to the user's render.
 */
const CLASS_LABELS: Array<{ match: RegExp; phase: JobPhase; label: string }> = [
  { match: /CheckpointLoader|UNETLoader|ImageOnlyCheckpointLoader/, phase: 'loading', label: 'Streaming model weights into VRAM' },
  { match: /CLIPTextEncode/, phase: 'loading', label: 'Encoding the prompt' },
  { match: /CLIPVisionLoader|IPAdapter|InsightFace|LoraLoader/, phase: 'loading', label: 'Loading face-identity adapters' },
  { match: /LoadImage|ImageScale|RembgForegroundMask/, phase: 'preparing', label: 'Preparing the reference image' },
  { match: /SVD_img2vid_Conditioning/, phase: 'loading', label: 'Building video conditioning' },
  // Deliberately 'loading', not 'sampling'. ComfyUI marks the KSampler node as executing the
  // moment it is reached, but that node loads the checkpoint lazily before it denoises
  // anything - measured here at ~3.5 minutes of "executing KSampler" before the first step
  // arrived on a cold 16 GB Flux load. Trusting the node id alone therefore reported model
  // loading as sampling and drove the bar deep into the sampling band while no step had run.
  // The switch to 'sampling' happens on the first real progress message instead.
  { match: /KSampler/, phase: 'loading', label: 'Loading model weights for the sampler' },
  { match: /VAEDecode/, phase: 'decoding', label: 'Decoding latents to pixels' },
  { match: /ImageCompositeMasked/, phase: 'decoding', label: 'Compositing original faces back in' },
  { match: /SaveImage|SaveAnimatedWEBP/, phase: 'saving', label: 'Saving the result' },
];

function describeNode(workflow: Record<string, any>, nodeId: string): { phase: JobPhase; label: string } {
  const classType: string = workflow?.[nodeId]?.class_type || '';
  const hit = CLASS_LABELS.find((c) => c.match.test(classType));
  if (hit) return { phase: hit.phase, label: hit.label };
  // Unknown node: name the class rather than the graph id, and don't claim a phase we can't
  // infer - `loading` is the honest default since it precedes sampling in every graph here.
  return { phase: 'loading', label: classType ? `Running ${classType}` : `Running node ${nodeId}` };
}

function scale(phase: JobPhase, fraction: number): number {
  const [lo, hi] = PHASE_BANDS[phase];
  return Math.round(lo + Math.max(0, Math.min(1, fraction)) * (hi - lo));
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Drives one job end-to-end against local ComfyUI - real WebSocket dispatch, real progress
 * math, real Blob upload of the result. No fallback/simulated progress paths - any failure
 * reports honestly via cloud.postFail rather than silently retrying or faking success.
 *
 * Progress is reported on a fixed ~2s ticker rather than only when ComfyUI emits an event.
 * ComfyUI is silent for the entire model-load phase, which on a cold 16 GB checkpoint is most
 * of the run - so an event-driven-only reporter leaves the row frozen for minutes and the
 * dashboard cannot tell a loading job from a hung one. The ticker also carries the
 * interruptRequested flag back on every round trip, so Interrupt now responds during model
 * load instead of being ignored until the sampler starts.
 */
export async function runJob(job: ClaimedJob, comfyUrl: string): Promise<void> {
  const startTime = Date.now();
  // Declared up here because the preflight below needs it too - it was previously defined only
  // after the workflow was built, which is later than the first code that has to talk to ComfyUI.
  const cleanUrl = comfyUrl.replace(/\/$/, '');

  // Authoritative live check right before dispatch - api/jobs/index.ts already did a
  // best-effort pass using the last heartbeat, which can be a few seconds stale.
  let stats = await getSystemStatsInternal(comfyUrl);
  let preflight = runPreflightCheck(stats.vramFreeMb, job.modelType as MediaType);

  if (!preflight.passed) {
    // ComfyUI keeps the previous render's model resident, so a second generation routinely
    // arrived with only ~2.4 GB free against a 3800 MB (Flux) or 5200 MB (SDXL) requirement
    // and was rejected outright. That made back-to-back generation impossible without manually
    // purging VRAM between every job. The held memory is reclaimable by definition here, so
    // reclaim it and re-check rather than failing on a condition the worker can resolve itself.
    console.log(
      `[worker] Preflight short by ${preflight.requiredFreeMb - stats.vramFreeMb} MB - reclaiming ComfyUI VRAM and retrying.`
    );
    try {
      await fetch(`${cleanUrl}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
      // CUDA hands memory back asynchronously; poll rather than guess a single sleep length.
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        stats = await getSystemStatsInternal(comfyUrl);
        preflight = runPreflightCheck(stats.vramFreeMb, job.modelType as MediaType);
        if (preflight.passed) break;
      }
      if (preflight.passed) {
        noteVramPurged(stats.vramUsedMb);
        console.log(`[worker] Reclaim succeeded - ${stats.vramFreeMb} MB free, proceeding.`);
      }
    } catch (err) {
      console.error('[worker] VRAM reclaim before preflight failed:', err);
    }
  }

  if (!preflight.passed) {
    // "Another process is holding GPU memory" was misleading in the most common case: usually
    // it is ComfyUI itself, still executing an abandoned render that /free cannot touch because
    // its weights are in active use. Observed a scene-swap prompt 29 minutes in, pinning 7.9 of
    // 8 GB, while every new job failed with a message pointing at the wrong culprit. Naming the
    // real blocker turns an unactionable error into a clear instruction.
    let blocker = 'another process is holding GPU memory';
    try {
      const queue: any = await (await fetch(`${cleanUrl}/queue`)).json();
      const running = (queue?.queue_running ?? [])[0];
      if (running) {
        const startedMs = Number(running?.[3]?.create_time);
        const forMin = Number.isFinite(startedMs) ? Math.round((Date.now() - startedMs) / 60000) : null;
        blocker =
          `ComfyUI is still executing an earlier render (prompt ${running?.[1] ?? 'unknown'}` +
          `${forMin !== null ? `, ${forMin} min so far` : ''}) and its weights cannot be unloaded while in use. ` +
          `If it is stuck, restart ComfyUI to release the GPU.`;
      }
    } catch {
      // Fall back to the generic wording if ComfyUI cannot be queried.
    }

    await cloud.postFail(
      job.id,
      `OOM Pre-flight Guardrail: this model needs ${preflight.requiredFreeMb} MB free VRAM but only ${stats.vramFreeMb} MB is available even after unloading ComfyUI's models - ${blocker}`
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

  // Node "1" is the checkpoint/model loader in every workflow workflowMapper builds.
  const requiredCkpt = (workflow['1'] as any)?.inputs?.ckpt_name;
  if (typeof requiredCkpt === 'string') {
    const installed = await listInstalledCheckpoints(cleanUrl);
    if (installed && !installed.includes(requiredCkpt)) {
      await cloud.postFail(
        job.id,
        `ComfyUI has no checkpoint named "${requiredCkpt}" - this model can't render until that file is in ComfyUI's models/checkpoints directory. Installed: ${
          installed.length ? installed.join(', ') : '(none)'
        }.`
      );
      return;
    }
  }

  const clientId = `worker_${crypto.randomUUID().slice(0, 8)}`;
  const wsUrl = cleanUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;

  await new Promise<void>((resolve) => {
    let settled = false;
    let samplingStartTime: number | null = null;
    let peakVramMb = stats.vramUsedMb;

    // ComfyUI keeps emitting `executing` events for the nodes AFTER the sampler (VAE decode,
    // save) - those used to report their flat 15%, dragging the bar backwards from a just-
    // reached 100%. Progress is monotonic instead: the reported number never goes down, so
    // the post-sampling phase holds at the sampler's last value while nodeTitle keeps
    // narrating which node is actually running.
    let lastPercentage = 0;
    const advance = (p: number): number => {
      lastPercentage = Math.max(lastPercentage, p);
      return lastPercentage;
    };

    // Live view of the render, owned by the WS handlers and read by the ticker below.
    let phase: JobPhase = 'loading';
    let label = 'Waiting for ComfyUI to start the graph';
    let sampleStep: number | null = null;
    let sampleMax: number | null = null;
    let etaSeconds: number | undefined;
    let promptId: string | null = null;

    const handleInterrupt = () => {
      finalize(async () => {
        ws.close();
        fetch(`${cleanUrl}/interrupt`, { method: 'POST' }).catch(() => {});
        fetch(`${cleanUrl}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {});
        await cloud.postFail(job.id, 'Generation interrupted by user request.', true);
      });
    };

    /**
     * Single place that computes and posts a progress row. Percentage comes from the live step
     * counter while sampling (exact), and from elapsed-vs-historical-average otherwise -
     * `job.avgDurationMs` is null until a model has completed here at least once, and in that
     * case no ETA is reported at all rather than a guessed one.
     */
    const report = async (): Promise<void> => {
      if (settled) return;
      const elapsedMs = Date.now() - startTime;

      let vramCurrentMb: number | undefined;
      try {
        // VRAM only: the full telemetry call additionally round-trips to ComfyUI to recompute
        // an online/offline flag this ticker never reads, which at a 2s cadence was ~30
        // pointless HTTP requests a minute on top of the nvidia-smi spawn.
        const live = await readGpuVram();
        vramCurrentMb = live.vramUsedMb;
        peakVramMb = Math.max(peakVramMb, live.vramUsedMb);
      } catch {
        // Telemetry is best-effort mid-run - a failed read must not stall the whole report.
      }

      let percentage: number;
      if (phase === 'sampling' && sampleStep !== null && sampleMax) {
        percentage = scale('sampling', sampleStep / sampleMax);
      } else if (job.avgDurationMs) {
        // Cap below the band ceiling so a slower-than-average run keeps creeping instead of
        // parking at 100% while still working - overshoot is honest, a fake finish is not.
        percentage = scale(phase, Math.min(elapsedMs / job.avgDurationMs, 0.97));
        etaSeconds = Math.max(0, Math.round((job.avgDurationMs - elapsedMs) / 1000));
      } else {
        percentage = PHASE_BANDS[phase][0];
        etaSeconds = undefined;
      }

      const suffix =
        job.avgDurationMs || phase === 'sampling'
          ? ''
          : ' (no timing history for this model yet)';

      const patch: ProgressPatch = {
        percentage: advance(percentage),
        phase,
        node: phase,
        nodeTitle: `${label} - ${formatDuration(elapsedMs)} elapsed${suffix}`,
        elapsedMs,
        vramCurrentMb,
        etaSeconds,
        step: sampleStep,
        maxSteps: sampleStep !== null ? sampleMax : null,
      };

      const { interruptRequested } = await cloud.postProgress(job.id, patch).catch(() => ({
        interruptRequested: false,
      }));
      if (interruptRequested) handleInterrupt();
    };

    // The heartbeat of the whole progress system. Runs regardless of ComfyUI activity, which
    // is the entire point: during model load ComfyUI emits nothing at all.
    const ticker = setInterval(() => {
      void report();
    }, PROGRESS_TICK_MS);

    // Chains fn()'s own promise (if it returns one) into the outer resolve - callers don't
    // need to await finalize() themselves, but runJob's promise still won't settle until any
    // async cleanup (e.g. the Blob upload on success) actually finishes.
    const finalize = (fn: () => void | Promise<void>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(absoluteHandle);
      clearInterval(ticker);
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

    const abortRender = (reason: string) => {
      finalize(async () => {
        await cloud.postFail(job.id, reason);
        try {
          ws.close();
        } catch {}
        fetch(`${cleanUrl}/interrupt`, { method: 'POST' }).catch(() => {});
        fetch(`${cleanUrl}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        }).catch(() => {});
      });
    };

    // Rearmed by every ComfyUI message for this prompt (see touchActivity), so the clock only
    // runs while ComfyUI is silent.
    let timeoutHandle = setTimeout(
      () => abortRender(`ComfyUI went silent for ${INACTIVITY_TIMEOUT_MS / 60000} minutes mid-render - treating it as hung.`),
      INACTIVITY_TIMEOUT_MS
    );

    const absoluteHandle = setTimeout(
      () => abortRender(`GPU execution exceeded the ${ABSOLUTE_TIMEOUT_MS / 60000}-minute hard ceiling.`),
      ABSOLUTE_TIMEOUT_MS
    );

    const touchActivity = () => {
      if (settled) return;
      clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(
        () => abortRender(`ComfyUI went silent for ${INACTIVITY_TIMEOUT_MS / 60000} minutes mid-render - treating it as hung.`),
        INACTIVITY_TIMEOUT_MS
      );
    };

    ws.on('open', async () => {
      try {
        const res = await fetch(`${cleanUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        });
        if (res.ok) {
          // Retained so /history can be consulted for this exact prompt later - previously the
          // response body was discarded, leaving the WS payload as the only route to the result.
          promptId = (await res.clone().json().catch(() => null))?.prompt_id ?? null;
        }
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

        // Any message at all counts as ComfyUI being alive - including progress_state, which
        // 0.33.x emits steadily and which this handler otherwise ignores. That matters: during
        // the sampler's long pre-step load, progress_state was often the ONLY traffic.
        touchActivity();

        // The WS handlers below only update local state - they never post. The ticker is the
        // single publisher, which keeps the reported row consistent (one writer, one shape)
        // and means a burst of ComfyUI events can't spam the API with a write per event.
        if (msg.type === 'executing') {
          const nodeId = msg.data.node;
          if (nodeId !== null) {
            const described = describeNode(workflow, String(nodeId));
            phase = described.phase;
            label = described.label;
            // Leaving the sampler: stop reporting a step counter that is no longer advancing.
            if (phase !== 'sampling') sampleStep = null;
          }
        } else if (msg.type === 'progress') {
          const { value, max } = msg.data;
          if (samplingStartTime === null) samplingStartTime = Date.now();
          phase = 'sampling';
          label = 'Denoising latents';
          sampleStep = value;
          sampleMax = max;

          // Live step-rate extrapolation beats the historical average once sampling is
          // underway: it reflects this run's actual speed on this resolution and step count.
          //
          // Needs >= 2 steps of evidence. samplingStartTime is stamped on the FIRST progress
          // message, so at value=1 the measured elapsed-since-start is ~0, giving msPerStep ~0
          // and an ETA of "0s" on a render with steps still to go - observed exactly that on
          // a 4-step Flux run. Below the threshold, leave the historical estimate in place.
          if (value >= 2) {
            const msPerStep = (Date.now() - samplingStartTime) / value;
            etaSeconds = Math.max(0, Math.round((msPerStep * (max - value)) / 1000));
          }
        } else if (msg.type === 'executed' || msg.type === 'execution_success') {
          // `executed` carries the outputs inline; `execution_success` (0.33.x) only says the
          // prompt finished. Falling back to /history for the latter means the run is
          // recoverable even if the inline payload is missed or its shape changes again -
          // /history is ComfyUI's own durable record of what a prompt produced.
          let output = msg.data?.output;
          if (!output && promptId) {
            try {
              const hist: any = await (await fetch(`${cleanUrl}/history/${promptId}`)).json();
              const outputs = hist?.[promptId]?.outputs ?? {};
              output = Object.values(outputs).find((o: any) => o?.images?.length || o?.gifs?.length || o?.animated?.length);
            } catch {
              // Leave output undefined - handled as "nothing produced" below.
            }
          }

          const media = output?.images?.[0] ?? output?.animated?.[0] ?? output?.gifs?.[0];
          const filename: string = media?.filename ?? '';
          const subfolder: string = media?.subfolder ?? '';
          const type: string = media?.type ?? 'output';

          if (filename) {
            // Blob upload happens inside finalize, which stops the ticker - so publish the
            // uploading phase once here, or the row's last visible state would be "saving"
            // for however long the upload takes.
            phase = 'uploading';
            label = 'Uploading to cloud storage';
            await report();

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
