/**
 * src/gateway/types.ts
 * Core TypeScript interfaces for WorkflowParams, ComfyUI WebSocket events, and Hardware Telemetry.
 */

export type ModelType = 'image_fast' | 'image_hd' | 'video_short';
export type AspectRatio = '1:1' | '16:9' | '9:16';
export type MediaType = 'image' | 'video' | 'image_fast' | 'image_hd' | 'video_short';

export interface WorkflowParams {
  prompt: string;
  modelType?: ModelType;
  aspectRatio: AspectRatio;
  mediaType?: MediaType | string;
  seed?: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  negativePrompt?: string;
  /** Filename of an image already uploaded to ComfyUI's input directory via /api/upload-image. */
  referenceImage?: string;
  /**
   * Real pixel dimensions of referenceImage, read server-side at upload time. Used to size
   * the newly-generated background canvas to exactly match the original photo so the
   * face-preserving composite (see workflowMapper.ts's scene-swap graph) can paste the
   * original people back with zero stretch/misalignment.
   */
  referenceImageWidth?: number;
  referenceImageHeight?: number;
}

/**
 * ComfyUI WebSocket Event Interfaces
 */
export interface ComfyWSStatusEvent {
  type: 'status';
  data: {
    status: {
      exec_info: {
        queue_remaining: number;
      };
    };
    sid?: string;
  };
}

export interface ComfyWSExecutionStartEvent {
  type: 'execution_start';
  data: {
    prompt_id: string;
    timestamp: number;
  };
}

export interface ComfyWSExecutingEvent {
  type: 'executing';
  data: {
    node: string | null;
    display_node?: string;
    prompt_id: string;
  };
}

export interface ComfyWSProgressEvent {
  type: 'progress';
  data: {
    value: number;
    max: number;
    prompt_id: string;
    node?: string;
  };
}

export interface ComfyWSExecutedEvent {
  type: 'executed';
  data: {
    node: string;
    display_node?: string;
    output: {
      images?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
      animated?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
      gifs?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
    };
    prompt_id: string;
  };
}

export interface ComfyWSExecutionCachedEvent {
  type: 'execution_cached';
  data: {
    nodes: string[];
    prompt_id: string;
  };
}

export interface ComfyWSErrorEvent {
  type: 'execution_error';
  data: {
    prompt_id: string;
    node_id: string;
    node_type: string;
    exception_message: string;
    exception_type: string;
    traceback: string[];
  };
}

export type ComfyWSEvent =
  | ComfyWSStatusEvent
  | ComfyWSExecutionStartEvent
  | ComfyWSExecutingEvent
  | ComfyWSProgressEvent
  | ComfyWSExecutedEvent
  | ComfyWSExecutionCachedEvent
  | ComfyWSErrorEvent;

/**
 * Hardware Telemetry Interface for RTX 3060 Ti & Host System
 */
export interface HardwareTelemetry {
  ramUsedMb: number;
  ramTotalMb: number;
  vramFreeMb: number;
  vramTotalMb: number;
  vramUsedMb: number;
  vramUsagePercent: number;
  oomRisk: boolean;
  status: 'ONLINE' | 'OFFLINE';
  systemRamTotalMb: number;
  systemRamFreeMb: number;
  device: string;
  comfyUrl: string;
  isTunnelConnected: boolean;
  online?: boolean;
  error?: string;
  details?: string;
  /** VRAM currently held by ComfyUI PyTorch caching allocator that can be released */
  reclaimableVramMb?: number;
  /** ISO timestamp of the worker's last heartbeat - absent only if it has never reported in. */
  lastSeenAt?: string;
  preflightCheck: {
    passed: boolean;
    recommendedMediaType: MediaType[];
    warnings: string[];
  };
}

export type SystemStats = HardwareTelemetry;

/**
 * Server-Sent Events (SSE) Progress Payload
 */
/**
 * Stage of a render, reported by the worker on every progress tick. Distinct from `status`,
 * which only says queued/processing/terminal - `phase` is what lets the UI explain a long
 * silent stretch as "streaming model weights" rather than an unexplained stall.
 */
export type JobPhase = 'preparing' | 'loading' | 'sampling' | 'decoding' | 'saving' | 'uploading' | 'done' | 'failed' | 'interrupted';

export interface SSEProgressPayload {
  promptId: string;
  percentage: number;
  phase?: JobPhase;
  /** Jobs ahead of this one in the queue; only present while status is 'queued'. */
  queuePosition?: number;
  /** Whether the PC worker is currently reporting in; only present while status is 'queued'. */
  workerOnline?: boolean;
  step?: number;
  maxSteps?: number;
  node?: string;
  nodeTitle?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'interrupted';
  mediaUrl?: string;
  localFilePath?: string;
  error?: string;
  vramFreeMb?: number;
  vramPeakMb?: number;
  vramCurrentMb?: number;
  etaSeconds?: number;
  elapsedMs?: number;
  durationMs?: number;
}

export type StreamProgressEvent = SSEProgressPayload;

/**
 * Real average render duration for one model type, computed from actually-completed jobs in
 * SQLite (see getDurationStats in db/store.ts). avgDurationMs is null when that model has
 * never completed a run yet - the UI must show "No data yet", not a guessed number.
 */
export interface DurationStat {
  modelType: string;
  avgDurationMs: number | null;
  sampleCount: number;
}

/**
 * Plain-interface mirror of the Postgres `jobs` row (schema.pg.ts) for frontend use - kept
 * separate from that file (rather than importing it directly) so the browser bundle never
 * pulls in drizzle-orm/pg-core table builders just for a type.
 */
export interface CloudJob {
  id: string;
  prompt: string;
  encryptedPrompt: string | null;
  promptHash: string;
  modelType: string;
  aspectRatio: string;
  mediaType: string;
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  referenceImageUrl: string | null;
  referenceImageWidth: number | null;
  referenceImageHeight: number | null;
  status: 'queued' | 'claimed' | 'processing' | 'completed' | 'failed' | 'interrupted';
  percentage: number;
  phase: JobPhase | null;
  /** Added by GET /api/jobs/:id for queued rows only - not a stored column. */
  queuePosition?: number;
  workerOnline?: boolean;
  step: number | null;
  maxSteps: number | null;
  node: string | null;
  nodeTitle: string | null;
  etaSeconds: number | null;
  elapsedMs: number | null;
  vramCurrentMb: number | null;
  vramPeakMb: number | null;
  mediaUrl: string | null;
  durationMs: number;
  error: string | null;
  interruptRequested: boolean;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

export interface GatewaySettings {
  comfyUrl: string;
  authToken: string;
  encryptionSecret: string;
  autoOomCheck?: boolean;
  vramThresholdMb: number;
}

/**
 * Google AI Studio Function Calling Adapter Interfaces
 */
export interface AIStudioFunctionCallArgs {
  prompt: string;
  model_type?: ModelType;
  modelType?: ModelType;
  aspect_ratio?: AspectRatio;
  aspectRatio?: AspectRatio;
  media_type?: string;
  mediaType?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  /** Filename of an image already uploaded via /api/upload-image - required for video_short. */
  reference_image?: string;
  referenceImage?: string;
}

export type FunctionCallPayload = AIStudioFunctionCallArgs;

export interface AIStudioFunctionCallRequest {
  name?: string;
  args?: AIStudioFunctionCallArgs;
  prompt?: string;
  model_type?: ModelType;
  modelType?: ModelType;
  aspect_ratio?: AspectRatio;
  aspectRatio?: AspectRatio;
}

export interface AIStudioFunctionCallResponse {
  function_name: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED_OOM';
  prompt_id: string;
  media_type: string;
  aspect_ratio: string;
  vram_preflight_passed: boolean;
  warnings: string[];
  sse_stream_url: string;
  media_url?: string;
  message: string;
}

export interface EncryptedDataPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  hash: string;
}
