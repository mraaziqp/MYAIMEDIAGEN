import EventEmitter from 'events';
import WebSocket from 'ws';
import crypto from 'crypto';
import {
  WorkflowParams,
  GenerationRecord,
  StreamProgressEvent,
  MediaType,
} from '../types.js';
import { buildComfyUiWorkflow } from './workflowMapper.js';
import { getSystemStatsInternal, runPreflightCheck } from './vramMonitor.js';
import { saveGeneration, getSettings } from './db/store.js';
import { encryptData } from './cryptoUtils.js';

const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Thrown when a generation is requested while another job is already executing.
 * The gateway tracks exactly one in-flight job (currentExecutingPromptId); accepting a
 * second one would silently overwrite that tracking and break interrupt/timeout semantics.
 */
export class JobInProgressError extends Error {
  constructor(public readonly activePromptId: string) {
    super(`A generation job (${activePromptId}) is already executing on the RTX 3060 Ti. Wait for it to finish or interrupt it first.`);
  }
}

/**
 * Thrown server-side when the OOM pre-flight guardrail (settings.autoOomCheck) blocks a
 * job. This is the real enforcement point - it protects every entry point (POST /api/generate,
 * the AI Studio function-call route), not just the disabled Generate button in the UI.
 */
export class OomGuardrailError extends Error {
  constructor(public readonly vramFreeMb: number, public readonly requiredFreeMb: number) {
    super(`OOM Pre-flight Guardrail: this model needs ${requiredFreeMb} MB free VRAM, only ${vramFreeMb} MB is available.`);
  }
}

class ComfyService extends EventEmitter {
  private activeStreams: Map<string, (event: StreamProgressEvent) => void> = new Map();
  private currentExecutingPromptId: string | null = null;

  public async queueGeneration(params: WorkflowParams): Promise<{
    promptId: string;
    generation: GenerationRecord;
    warnings: string[];
    preflightPassed: boolean;
  }> {
    if (this.currentExecutingPromptId) {
      throw new JobInProgressError(this.currentExecutingPromptId);
    }

    // Claim the single execution slot synchronously (before any `await`) so a second
    // request arriving before this one finishes its first await sees the slot already taken.
    const promptId = `prompt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.currentExecutingPromptId = promptId;

    try {
      const settings = getSettings();
      const stats = await getSystemStatsInternal(settings.comfyUrl);
      const mediaTypeKey = (params.modelType || params.mediaType || 'image_fast') as MediaType;

      if (stats.status === 'OFFLINE') {
        throw new Error(
          `ComfyUI server is offline at ${settings.comfyUrl}. Please launch local ComfyUI (run_nvidia_gpu.bat).`
        );
      }

      const preflight = runPreflightCheck(stats.vramFreeMb, mediaTypeKey);

      if (settings.autoOomCheck !== false && !preflight.passed) {
        throw new OomGuardrailError(stats.vramFreeMb, preflight.requiredFreeMb);
      }

      const workflow = buildComfyUiWorkflow(params);
      const encPrompt = encryptData(params.prompt, settings.encryptionSecret);

      const record: GenerationRecord = {
        id: promptId,
        prompt: params.prompt,
        encryptedPrompt: encPrompt.ciphertext,
        promptHash: encPrompt.hash,
        modelType: mediaTypeKey as any,
        aspectRatio: params.aspectRatio,
        mediaType: mediaTypeKey === 'video_short' ? 'video' : 'image',
        mediaUrl: '',
        encryptedMediaUrl: '',
        localFilePath: `C:/ComfyUI/output/rtx3060ti_${promptId}.png`,
        seed: params.seed || Math.floor(Math.random() * 1000000000),
        steps: params.steps || (mediaTypeKey === 'image_fast' ? 4 : 20),
        cfg: params.cfg || (mediaTypeKey === 'image_fast' ? 1 : 7),
        samplerName: params.samplerName || 'euler',
        durationMs: 0,
        status: 'processing',
        vramPeakMb: stats.vramUsedMb,
        createdAt: new Date().toISOString(),
        metadataJson: JSON.stringify({
          comfyPromptId: promptId,
          modelType: mediaTypeKey,
          aspectRatio: params.aspectRatio,
        }),
      };

      saveGeneration(record);

      // Dispatch REAL job execution to local ComfyUI
      this.dispatchRealComfyPrompt(promptId, workflow, settings.comfyUrl, record, params);

      return {
        promptId,
        generation: record,
        warnings: preflight.warnings,
        preflightPassed: preflight.passed,
      };
    } catch (err) {
      // Failed before dispatch actually started (offline check, telemetry failure, etc.) - release the slot.
      if (this.currentExecutingPromptId === promptId) {
        this.currentExecutingPromptId = null;
      }
      throw err;
    }
  }

  /**
   * Connects to REAL local ComfyUI instance via HTTP POST & WebSocket.
   * No fallback/simulated progress paths exist here - every branch either reports
   * genuine ComfyUI state or fails the job outright via handleJobError.
   */
  private async dispatchRealComfyPrompt(
    promptId: string,
    workflow: any,
    comfyUrl: string,
    record: GenerationRecord,
    params: WorkflowParams
  ) {
    const cleanUrl = comfyUrl.replace(/\/$/, '');
    const clientId = `gateway_${crypto.randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    // Guards against double-settling the job (e.g. a 'close' event firing after
    // 'executed' already completed it, or the timeout firing after a late success).
    let settled = false;

    const wsUrl = cleanUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err: any) {
      this.handleJobError(promptId, record, err?.message || `Failed to open WebSocket to ${wsUrl}`, 'dispatch_error');
      return;
    }

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      this.handleJobError(
        promptId,
        record,
        `GPU execution timed out after 5 minutes with no 'executed' event from ComfyUI (the GPU may be hung).`,
        'timeout'
      );
      try {
        ws.close();
      } catch {}
      // Best-effort attempt to free the hung GPU job; failure here doesn't change the outcome above.
      fetch(`${cleanUrl}/interrupt`, { method: 'POST' }).catch(() => {});
    }, EXECUTION_TIMEOUT_MS);

    const finalize = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      fn();
    };

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
          this.handleJobError(promptId, record, err?.message || 'Failed to submit workflow to ComfyUI', 'dispatch_error');
          ws.close();
        });
      }
    });

    ws.on('message', (data: WebSocket.RawData) => {
      if (settled) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'executing') {
          const nodeId = msg.data.node;
          if (nodeId === null) {
            // Execution finished
          } else {
            this.emitProgress({
              promptId,
              status: 'processing',
              node: `Node_${nodeId}`,
              nodeTitle: `Executing Node ${nodeId}`,
              percentage: 20,
            });
          }
        } else if (msg.type === 'progress') {
          const { value, max } = msg.data;
          const pct = Math.round((value / max) * 100);
          this.emitProgress({
            promptId,
            status: 'processing',
            node: 'KSampler',
            nodeTitle: 'Denoising Latents on RTX 3060 Ti',
            step: value,
            maxSteps: max,
            percentage: pct,
          });
        } else if (msg.type === 'executed') {
          const output = msg.data.output;
          let filename = '';
          let subfolder = '';
          let type = 'output';

          if (output?.images && output.images.length > 0) {
            filename = output.images[0].filename;
            subfolder = output.images[0].subfolder || '';
            type = output.images[0].type || 'output';
          } else if (output?.animated && output.animated.length > 0) {
            filename = output.animated[0].filename;
            subfolder = output.animated[0].subfolder || '';
          } else if (output?.gifs && output.gifs.length > 0) {
            filename = output.gifs[0].filename;
            subfolder = output.gifs[0].subfolder || '';
          }

          if (filename) {
            finalize(() => {
              const durationMs = Date.now() - startTime;
              // Relative path through the gateway's own /api/view proxy, not ComfyUI's origin
              // directly - ComfyUI has CORS disabled by default (breaks fetch/Share), the
              // `download` attribute is ignored cross-origin (breaks Download), and 127.0.0.1
              // is meaningless to anyone accessing the dashboard remotely through the tunnel.
              const mediaUrl = `/api/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(
                subfolder
              )}&type=${type}`;
              const localFilePath = `C:/ComfyUI/output/${filename}`;

              record.status = 'completed';
              record.mediaUrl = mediaUrl;
              record.localFilePath = localFilePath;
              record.durationMs = durationMs;
              saveGeneration(record);

              if (this.currentExecutingPromptId === promptId) {
                this.currentExecutingPromptId = null;
              }

              this.emitProgress({
                promptId,
                status: 'completed',
                node: 'SaveImage',
                nodeTitle: 'Render Finished & Vaulted',
                percentage: 100,
                mediaUrl,
                localFilePath,
                durationMs,
              });

              ws.close();
            });
          }
        } else if (msg.type === 'execution_error') {
          const errDetail = msg.data?.exception_message || msg.data?.exception_type || 'ComfyUI execution error';
          finalize(() => {
            this.handleJobError(promptId, record, errDetail, 'execution_error');
            ws.close();
          });
        }
      } catch (e) {}
    });

    ws.on('error', (err) => {
      finalize(() => {
        this.handleJobError(promptId, record, `ComfyUI WebSocket error: ${err.message}`, 'websocket_error');
      });
    });

    ws.on('close', (code) => {
      // A close that arrives after the job already settled (normal completion/failure) is expected - ignore it.
      finalize(() => {
        this.handleJobError(
          promptId,
          record,
          `ComfyUI WebSocket connection dropped unexpectedly before the job completed (close code ${code}).`,
          'websocket_closed'
        );
      });
    });
  }

  private handleJobError(promptId: string, record: GenerationRecord, errorMsg: string, reasonCode: string = 'error') {
    const isOom = /out[\s-]?of[\s-]?memory|\boom\b|cuda error|insufficient memory|allocat(e|ion) failed/i.test(errorMsg);

    record.status = 'failed';

    let existingMeta: Record<string, any> = {};
    try {
      existingMeta = record.metadataJson ? JSON.parse(record.metadataJson) : {};
    } catch {}
    record.metadataJson = JSON.stringify({
      ...existingMeta,
      failureReason: reasonCode,
      isOom,
      errorMessage: errorMsg,
      failedAt: new Date().toISOString(),
    });

    saveGeneration(record);

    if (this.currentExecutingPromptId === promptId) {
      this.currentExecutingPromptId = null;
    }

    console.error(`[ComfyService] Job ${promptId} failed (${reasonCode}${isOom ? ', OOM' : ''}): ${errorMsg}`);

    this.emitProgress({
      promptId,
      status: 'failed',
      node: isOom ? 'OOM_Guard' : 'ErrorNode',
      nodeTitle: isOom ? 'GPU Out-Of-Memory' : 'GPU Execution Failed',
      percentage: 0,
      error: errorMsg,
    });
  }

  public registerStreamListener(promptId: string, callback: (event: StreamProgressEvent) => void) {
    this.activeStreams.set(promptId, callback);
  }

  public removeStreamListener(promptId: string) {
    this.activeStreams.delete(promptId);
  }

  private emitProgress(event: StreamProgressEvent) {
    const callback = this.activeStreams.get(event.promptId);
    if (callback) {
      callback(event);
    }
    this.emit('progress', event);
  }

  public isJobInProgress(): boolean {
    return this.currentExecutingPromptId !== null;
  }

  /**
   * Real ComfyUI API (confirmed against server.py's POST /free handler): unloads models
   * from VRAM and frees the memory cache. Refused while a job is executing - unloading
   * models mid-render would corrupt that job.
   */
  public async freeVram(comfyUrl: string): Promise<void> {
    if (this.currentExecutingPromptId) {
      throw new JobInProgressError(this.currentExecutingPromptId);
    }

    const cleanUrl = comfyUrl.replace(/\/$/, '');
    const res = await fetch(`${cleanUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ComfyUI returned HTTP ${res.status} freeing VRAM: ${errText}`);
    }
  }

  public async interruptCurrentTask(comfyUrl: string): Promise<boolean> {
    const previousPromptId = this.currentExecutingPromptId;
    this.currentExecutingPromptId = null;

    if (previousPromptId) {
      this.emitProgress({
        promptId: previousPromptId,
        status: 'interrupted',
        node: 'Interrupt',
        nodeTitle: 'Halted by User Interrupt Signal',
        percentage: 0,
        error: 'Generation interrupted.',
      });
    }

    try {
      const cleanUrl = comfyUrl.replace(/\/$/, '');
      await fetch(`${cleanUrl}/interrupt`, { method: 'POST' });
      return true;
    } catch (err) {
      return true;
    }
  }
}

export const comfyService = new ComfyService();
