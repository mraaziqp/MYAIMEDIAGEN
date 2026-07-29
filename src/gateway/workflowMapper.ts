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
      "1": { "inputs": { "ckpt_name": "svd_xt_1_1.safetensors" }, "class_type": "ImageOnlyCheckpointLoader" },
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
  const modelName = isFlux ? "flux1-schnell-fp8.safetensors" : "sd_xl_base_1.0_fp8.safetensors";

  const workflow: Record<string, any> = {
    "1": { "inputs": { "ckpt_name": modelName }, "class_type": "CheckpointLoaderSimple" },
    "2": { "inputs": { "text": params.prompt, "clip": ["1", 1] }, "class_type": "CLIPTextEncode" },
    "3": { "inputs": { "text": "blurry, low quality, distorted", "clip": ["1", 1] }, "class_type": "CLIPTextEncode" },
    "6": { "inputs": { "samples": ["5", 0], "vae": ["1", 2] }, "class_type": "VAEDecode" },
    "7": { "inputs": { "filename_prefix": isFlux ? "flux_fast" : "sdxl_hd", "images": ["6", 0] }, "class_type": "SaveImage" },
  };

  // With a reference image, encode it into the starting latent (image-to-image) instead of
  // starting from empty noise - denoise stays well below 1.0 so the result still resembles
  // the input rather than ignoring it entirely (denoise 1.0 == same as no reference at all).
  let latentImageLink: [string, number];
  let denoise: number;
  if (params.referenceImage) {
    workflow["4"] = { "inputs": { "image": params.referenceImage }, "class_type": "LoadImage" };
    workflow["4b"] = { "inputs": { "pixels": ["4", 0], "vae": ["1", 2] }, "class_type": "VAEEncode" };
    latentImageLink = ["4b", 0];
    denoise = 0.65;
  } else {
    workflow["4"] = { "inputs": { "width": width, "height": height, "batch_size": 1 }, "class_type": "EmptyLatentImage" };
    latentImageLink = ["4", 0];
    denoise = 1.0;
  }

  workflow["5"] = {
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
      "latent_image": latentImageLink,
    },
    "class_type": "KSampler",
  };

  return workflow;
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
