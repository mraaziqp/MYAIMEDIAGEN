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

  const baseNegative = params.negativePrompt || "blurry, low quality, distorted";

  const workflow: Record<string, any> = {
    "1": { "inputs": { "ckpt_name": modelName }, "class_type": "CheckpointLoaderSimple" },
    "2": { "inputs": { "text": params.prompt, "clip": ["1", 1] }, "class_type": "CLIPTextEncode" },
  };

  if (params.referenceImage && !isFlux) {
    // Full face-identity regeneration (SDXL only - no Flux FaceID model is installed).
    // Unlike the pixel-composite scene swap below, this actually RE-POSES and RE-LIGHTS
    // the subject into the new scene: IPAdapter FaceID extracts a face embedding via
    // InsightFace (identity) plus a CLIP vision embedding of the aligned face crop, and
    // injects both into the UNet's cross-attention alongside its paired LoRA - the whole
    // image is genuinely regenerated, not stitched, so the result can show a different
    // pose/angle/lighting while keeping the person recognizable.
    workflow["3"] = { "inputs": { "text": baseNegative, "clip": ["1", 1] }, "class_type": "CLIPTextEncode" };
    workflow["4"] = { "inputs": { "image": params.referenceImage }, "class_type": "LoadImage" };
    workflow["5"] = { "inputs": { "ipadapter_file": "ip-adapter-faceid_sdxl.bin" }, "class_type": "IPAdapterModelLoader" };
    workflow["6"] = { "inputs": { "provider": "CPU", "model_name": "buffalo_l" }, "class_type": "IPAdapterInsightFaceLoader" };
    workflow["7"] = { "inputs": { "clip_name": "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors" }, "class_type": "CLIPVisionLoader" };
    workflow["8"] = {
      "inputs": { "model": ["1", 0], "lora_name": "ip-adapter-faceid_sdxl_lora.safetensors", "strength_model": 0.6 },
      "class_type": "LoraLoaderModelOnly",
    };
    workflow["9"] = {
      "inputs": {
        "model": ["8", 0],
        "ipadapter": ["5", 0],
        "image": ["4", 0],
        "clip_vision": ["7", 0],
        "insightface": ["6", 0],
        "weight": 1.0,
        "weight_faceidv2": 1.0,
        "weight_type": "linear",
        "combine_embeds": "concat",
        "start_at": 0.0,
        "end_at": 1.0,
        "embeds_scaling": "V only",
      },
      "class_type": "IPAdapterFaceID",
    };
    workflow["10"] = { "inputs": { "width": width, "height": height, "batch_size": 1 }, "class_type": "EmptyLatentImage" };
    workflow["11"] = {
      "inputs": {
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler_name": "dpmpp_2m",
        "scheduler": "karras",
        "denoise": 1.0,
        "model": ["9", 0],
        "positive": ["2", 0],
        "negative": ["3", 0],
        "latent_image": ["10", 0],
      },
      "class_type": "KSampler",
    };
    workflow["12"] = { "inputs": { "samples": ["11", 0], "vae": ["1", 2] }, "class_type": "VAEDecode" };
    workflow["13"] = { "inputs": { "filename_prefix": "sdxl_faceid", "images": ["12", 0] }, "class_type": "SaveImage" };
    return workflow;
  }

  if (params.referenceImage) {
    // Flux fallback - face-preserving scene swap via pixel composite (see the SDXL FaceID
    // branch above for the primary, better path; Flux has no FaceID adapter available).
    // Plain img2img re-diffuses the ENTIRE photo (faces included) at whatever denoise is
    // dialed in, which is why a moderate-to-high denoise (needed to actually change the
    // scene) also warps faces - there is no denoise value that reliably changes the
    // background while leaving people untouched, because img2img has no concept of
    // "people" at all. Instead: segment the people out with a real foreground mask (rembg,
    // via the RembgForegroundMask custom node), generate a brand new background from
    // scratch (full denoise, unconstrained by the old composition), and composite the
    // ORIGINAL unmodified photo pixels back on top using that mask. Faces are never
    // re-diffused - they're pasted back byte-for-byte.
    const [rw, rh] = roundToMultipleOf8(
      params.referenceImageWidth || width,
      params.referenceImageHeight || height
    );

    workflow["3"] = {
      "inputs": { "text": `${baseNegative}, people, humans, person, extra faces, duplicate figures`, "clip": ["1", 1] },
      "class_type": "CLIPTextEncode",
    };
    // Normalizes the source photo to the exact dims the generated background will use -
    // center-crop (not stretch) so faces are never distorted, only trimmed by at most a few
    // pixels at the edges to reach a multiple of 8 (required for the latent/VAE pipeline).
    workflow["4"] = { "inputs": { "image": params.referenceImage }, "class_type": "LoadImage" };
    workflow["4b"] = {
      "inputs": { "image": ["4", 0], "upscale_method": "lanczos", "width": rw, "height": rh, "crop": "center" },
      "class_type": "ImageScale",
    };
    workflow["4c"] = { "inputs": { "image": ["4b", 0] }, "class_type": "RembgForegroundMask" };
    workflow["5"] = { "inputs": { "width": rw, "height": rh, "batch_size": 1 }, "class_type": "EmptyLatentImage" };
    workflow["6"] = {
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
        "latent_image": ["5", 0],
      },
      "class_type": "KSampler",
    };
    workflow["7"] = { "inputs": { "samples": ["6", 0], "vae": ["1", 2] }, "class_type": "VAEDecode" };
    workflow["8"] = {
      "inputs": { "destination": ["7", 0], "source": ["4b", 0], "x": 0, "y": 0, "resize_source": false, "mask": ["4c", 0] },
      "class_type": "ImageCompositeMasked",
    };
    workflow["9"] = {
      "inputs": { "filename_prefix": isFlux ? "flux_fast_sceneswap" : "sdxl_hd_sceneswap", "images": ["8", 0] },
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
