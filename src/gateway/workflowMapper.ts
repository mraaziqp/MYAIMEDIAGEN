import { WorkflowParams } from './types';

export interface ComfyUIWorkflowPrompt {
  [nodeId: string]: {
    inputs: Record<string, any>;
    class_type: string;
    _meta?: { title?: string };
  };
}

export function buildComfyUiWorkflow(params: WorkflowParams): Record<string, any> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const mediaTypeKey = params.modelType || params.mediaType || 'image_fast';
  const [width, height] = resolveDimensions(params.aspectRatio || '1:1', mediaTypeKey);

  if (mediaTypeKey === 'video_short') {
    // SVD is image-to-video, not text-to-video - server.ts already rejects this case
    // without a reference image before it ever reaches here, but stay defensive.
    if (!params.referenceImage) {
      throw new Error('video_short requires a reference image (referenceImage) - SVD has no text-to-video path.');
    }

    return {
      // Node "1" is always the checkpoint/model loader across every workflow this file
      // builds - comfyService.ts's progress reporting keys off that to report a slow model
      // load honestly instead of a flat, misleading percentage.
      // SVD-XT 1.0, not 1.1: the 1.1 weights sit behind a gated HuggingFace repo (401 without
      // an account that has accepted Stability's license), so the openly downloadable 1.0
      // release is what's actually installed. Same architecture and node graph either way.
      "1": { "inputs": { "ckpt_name": "svd_xt.safetensors" }, "class_type": "ImageOnlyCheckpointLoader" },
      "2": { "inputs": { "image": params.referenceImage }, "class_type": "LoadImage" },
      "3": {
        "inputs": {
          "clip_vision": ["1", 1],
          "init_image": ["2", 0],
          "vae": ["1", 2],
          "width": width,
          "height": height,
          "video_frames": 16,
          "motion_bucket_id": 127,
          "fps": 8,
          "augmentation_level": 0.0,
        },
        "class_type": "SVD_img2vid_Conditioning",
      },
      "4": {
        "inputs": {
          "seed": seed,
          "steps": params.steps || 20,
          "cfg": params.cfg || 2.5,
          "sampler_name": "euler",
          "scheduler": "karras",
          "denoise": 1.0,
          "model": ["1", 0],
          "positive": ["3", 0],
          "negative": ["3", 1],
          "latent_image": ["3", 2],
        },
        "class_type": "KSampler",
      },
      "5": { "inputs": { "samples": ["4", 0], "vae": ["1", 2] }, "class_type": "VAEDecode" },
      "6": {
        "inputs": {
          "filename_prefix": "rtx3060ti_video",
          "images": ["5", 0],
          "fps": 8.0,
          "lossless": false,
          "quality": 90,
          "method": "default",
        },
        "class_type": "SaveAnimatedWEBP",
      },
    };
  }

  const isFlux = mediaTypeKey === 'image_fast';
  const steps = isFlux ? (params.steps || 4) : (params.steps || 25);
  const cfg = isFlux ? 1.0 : (params.cfg || 7.0);
  // Stability never shipped an official fp8 SDXL base checkpoint under the name this used to
  // reference, so nothing could ever load it - this is the real fp16 release. ComfyUI casts
  // and offloads it to fit the 3060 Ti's 8 GB on its own.
  const modelName = isFlux ? "flux1-schnell-fp8.safetensors" : "sd_xl_base_1.0.safetensors";

  const baseNegative = params.negativePrompt || "blurry, low quality, distorted";

  const workflow: Record<string, any> = {
    "1": { "inputs": { "ckpt_name": modelName }, "class_type": "CheckpointLoaderSimple" },
    "2": { "inputs": { "text": params.prompt, "clip": ["1", 1] }, "class_type": "CLIPTextEncode" },
  };

  if (params.referenceImage) {
    /**
     * True img2img: encode the reference into latent space and re-diffuse it at partial
     * denoise. Core nodes only - no custom nodes, no extra model files.
     *
     * This replaces two earlier reference-image paths that were both unusable in practice:
     *
     * 1. A "scene swap" for Flux that ran RembgForegroundMask to cut the subject out, generated
     *    a new background, then composited the ORIGINAL pixels back on top. It therefore could
     *    not change the subject at all - the opposite of what a request like "make the man look
     *    like a cat superhero" needs - and rembg is CPU-bound: measured at ~100% of one core,
     *    still running 29 minutes into a single render, holding 7945 of 8192 MiB of VRAM. That
     *    single node caused the stuck renders, the VRAM exhaustion, and the purge that could not
     *    free anything (weights in active use are not reclaimable).
     * 2. An IPAdapter FaceID graph for SDXL requiring ip-adapter-faceid_sdxl.bin, a buffalo_l
     *    InsightFace pack and CLIP-ViT-bigG - none of which are installed, so it could only ever
     *    have failed validation.
     *
     * Denoise is the one dial that matters here: low values stay close to the photo, high values
     * reinterpret it freely. 0.65 is a deliberate middle - enough to genuinely transform the
     * subject while keeping the original composition and pose recognisable.
     */
    const [rw, rh] = roundToMultipleOf8(
      params.referenceImageWidth || width,
      params.referenceImageHeight || height
    );
    const denoise = params.denoise ?? 0.65;

    workflow["3"] = { "inputs": { "text": baseNegative, "clip": ["1", 1] }, "class_type": "CLIPTextEncode" };
    workflow["4"] = { "inputs": { "image": params.referenceImage }, "class_type": "LoadImage" };
    // Centre-crop rather than stretch, so faces are never distorted - only trimmed slightly to
    // reach the multiple of 8 the latent pipeline requires.
    workflow["5"] = {
      "inputs": { "image": ["4", 0], "upscale_method": "lanczos", "width": rw, "height": rh, "crop": "center" },
      "class_type": "ImageScale",
    };
    workflow["6"] = { "inputs": { "pixels": ["5", 0], "vae": ["1", 2] }, "class_type": "VAEEncode" };
    workflow["7"] = {
      "inputs": {
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler_name": isFlux ? "euler_ancestral" : "dpmpp_2m",
        "scheduler": isFlux ? "simple" : "karras",
        "denoise": denoise,
        "model": ["1", 0],
        "positive": ["2", 0],
        "negative": ["3", 0],
        "latent_image": ["6", 0],
      },
      "class_type": "KSampler",
    };
    workflow["8"] = { "inputs": { "samples": ["7", 0], "vae": ["1", 2] }, "class_type": "VAEDecode" };
    workflow["9"] = {
      "inputs": { "filename_prefix": isFlux ? "flux_img2img" : "sdxl_img2img", "images": ["8", 0] },
      "class_type": "SaveImage",
    };
    return workflow;
  }


  workflow["3"] = { "inputs": { "text": baseNegative, "clip": ["1", 1] }, "class_type": "CLIPTextEncode" };
  workflow["4"] = { "inputs": { "width": width, "height": height, "batch_size": 1 }, "class_type": "EmptyLatentImage" };
  workflow["5"] = {
    "inputs": {
      "seed": seed,
      "steps": steps,
      "cfg": cfg,
      "sampler_name": isFlux ? "euler_ancestral" : "dpmpp_2m",
      "scheduler": isFlux ? "simple" : "karras",
      "denoise": 1.0,
      "model": ["1", 0],
      "positive": ["2", 0],
      "negative": ["3", 0],
      "latent_image": ["4", 0],
    },
    "class_type": "KSampler",
  };
  workflow["6"] = { "inputs": { "samples": ["5", 0], "vae": ["1", 2] }, "class_type": "VAEDecode" };
  workflow["7"] = { "inputs": { "filename_prefix": isFlux ? "flux_fast" : "sdxl_hd", "images": ["6", 0] }, "class_type": "SaveImage" };

  return workflow;
}

function roundToMultipleOf8(width: number, height: number): [number, number] {
  const rw = Math.max(64, Math.floor(width / 8) * 8);
  const rh = Math.max(64, Math.floor(height / 8) * 8);
  return [rw, rh];
}

export function buildComfyWorkflow(params: WorkflowParams): {
  workflow: Record<string, any>;
  seed: number;
  dimensions: { width: number; height: number };
} {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const mediaTypeKey = params.modelType || params.mediaType || 'image_fast';
  const [width, height] = resolveDimensions(params.aspectRatio || '1:1', mediaTypeKey);
  const workflow = buildComfyUiWorkflow(params);

  return {
    workflow,
    seed,
    dimensions: { width, height },
  };
}

function resolveDimensions(aspectRatio: string, mediaType: string): [number, number] {
  if (mediaType === 'video_short') {
    if (aspectRatio === '16:9') return [1024, 576];
    if (aspectRatio === '9:16') return [576, 1024];
    return [768, 768];
  }
  if (aspectRatio === '16:9') return [1280, 720];
  if (aspectRatio === '9:16') return [720, 1280];
  return [1024, 1024];
}
