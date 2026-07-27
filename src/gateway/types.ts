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
export interface SSEProgressPayload {
  promptId: string;
  percentage: number;
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
  durationMs?: number;
}

export type StreamProgressEvent = SSEProgressPayload;

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
