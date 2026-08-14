import React, { useState, useRef, useEffect } from 'react';
import { upload } from '@vercel/blob/client';
import { Sparkles, Zap, Video, Image, Shuffle, Ratio, Play, ShieldAlert, ImagePlus, X, Loader2, CheckCircle2, Trash2 } from 'lucide-react';
import { MediaType, AspectRatio, WorkflowParams, SystemStats, DurationStat } from '../types';

/** Read intrinsic pixel dimensions client-side - there's no server-side sharp step anymore
 *  now that uploads go straight from the browser to Blob storage (see handleFileSelect). */
function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('Failed to read image dimensions'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

interface GeneratorPanelProps {
  onGenerate: (params: WorkflowParams) => void;
  isGenerating: boolean;
  stats: SystemStats | null;
  durationStats: DurationStat[];
  onFreeVram?: () => void;
  isFreeingVram?: boolean;
}

/**
 * Real measured average for a model, formatted for the card badge - or an honest "No data
 * yet" when it has never completed a run, never a guessed number.
 */
function formatDurationBadge(stats: DurationStat[], modelType: string): string {
  const stat = stats.find((s) => s.modelType === modelType);
  if (!stat || stat.avgDurationMs === null) return 'No data yet';
  const seconds = stat.avgDurationMs / 1000;
  const formatted = seconds >= 10 ? Math.round(seconds).toString() : seconds.toFixed(1);
  return `~${formatted}s avg (${stat.sampleCount})`;
}

const PRESET_PROMPTS = [
  {
    title: 'Cyberpunk Tokyo',
    type: 'image_fast' as MediaType,
    aspect: '16:9' as AspectRatio,
    prompt: 'Cyberpunk neon alleyway in neo-Tokyo with rain reflections, glowing signs, cinematic 8k, photorealistic',
  },
  {
    title: 'Mechanical Hummingbird',
    type: 'image_fast' as MediaType,
    aspect: '1:1' as AspectRatio,
    prompt: 'Intricate mechanical steampunk hummingbird hovering near a glass flower, brass gears, polished copper, macro photography',
  },
  {
    title: 'Autumn Mountain Drone',
    type: 'image_hd' as MediaType,
    aspect: '16:9' as AspectRatio,
    prompt: 'Epic aerial drone shot of golden autumn forest surrounding misty alpine lake, morning sun rays, ultra detailed landscape',
  },
  {
    title: 'Sci-Fi Cyber Android',
    type: 'image_hd' as MediaType,
    aspect: '9:16' as AspectRatio,
    prompt: 'Portrait of futuristic cybernetic android with translucent porcelain shell and glowing blue fiber optics, dramatic studio lighting',
  },
];

export const GeneratorPanel: React.FC<GeneratorPanelProps> = ({
  onGenerate,
  isGenerating,
  stats,
  durationStats,
  onFreeVram,
  isFreeingVram = false,
}) => {
  const [prompt, setPrompt] = useState(
    'Cyberpunk neon alleyway in neo-Tokyo with rain reflections, glowing signs, cinematic 8k, photorealistic'
  );
  const [mediaType, setMediaType] = useState<MediaType>('image_fast');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [seed, setSeed] = useState<number>(Math.floor(Math.random() * 900000) + 100000);
  const [customSteps, setCustomSteps] = useState<number | ''>('');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadedWidth, setUploadedWidth] = useState<number | null>(null);
  const [uploadedHeight, setUploadedHeight] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke the local preview blob URL whenever it's replaced or the component unmounts -
  // otherwise each new image leaks the previous one for the life of the tab.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleRandomizeSeed = () => {
    setSeed(Math.floor(Math.random() * 900000) + 100000);
  };

  const handleFileSelect = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploadedImageUrl(null);
    setUploadedWidth(null);
    setUploadedHeight(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setIsUploading(true);

    try {
      // Uploads straight from the browser to Vercel Blob (api/upload-image.ts only issues a
      // short-lived upload token) - avoids proxying file bytes through a serverless
      // function, which would cap reference images well below what a phone photo can be.
      const [blob, dims] = await Promise.all([
        upload(file.name, file, { access: 'public', handleUploadUrl: '/api/upload-image' }),
        readImageDimensions(file),
      ]);
      setUploadedImageUrl(blob.url);
      setUploadedWidth(dims.width);
      setUploadedHeight(dims.height);
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to upload image');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setUploadedImageUrl(null);
    setUploadedWidth(null);
    setUploadedHeight(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePresetSelect = (preset: (typeof PRESET_PROMPTS)[0]) => {
    setPrompt(preset.prompt);
    setMediaType(preset.type);
    setAspectRatio(preset.aspect);
    handleRandomizeSeed();
  };

  // Pre-flight Memory requirement check - the same per-model thresholds the backend's
  // OOM guardrail enforces (vramMonitor.ts), checked here too so the button never invites
  // a click the server is just going to reject anyway.
  const requiredVramMb = mediaType === 'video_short' ? 6500 : mediaType === 'image_hd' ? 5200 : 3800;
  const freeVramMb = stats?.vramFreeMb ?? 0;

  // SVD is image-to-video - there is no text-to-video path, so a reference image isn't
  // optional for this model the way it is (as an img2img nudge) for Flux/SDXL.
  const needsReferenceImage = mediaType === 'video_short';
  const referenceImageMissing = needsReferenceImage && !uploadedImageUrl;

  const gpuUnavailable = !stats;
  const vramCritical = !!stats && freeVramMb < requiredVramMb;
  const submitBlocked =
    isGenerating || !prompt.trim() || gpuUnavailable || vramCritical || isUploading || referenceImageMissing;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitBlocked) return;

    onGenerate({
      prompt,
      mediaType,
      aspectRatio,
      seed: Number(seed),
      steps: customSteps ? Number(customSteps) : undefined,
      referenceImage: uploadedImageUrl || undefined,
      referenceImageWidth: uploadedWidth || undefined,
      referenceImageHeight: uploadedHeight || undefined,
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl text-slate-100">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">Local AI Studio Generator</h2>
            <p className="text-xs text-slate-400">RTX 3060 Ti ComfyUI Direct Function Execution</p>
          </div>
        </div>
      </div>

      {/* Preset Buttons Bar */}
      <div className="mb-5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
          Quick Preset Prompts
        </span>
        <div className="flex flex-wrap gap-2">
          {PRESET_PROMPTS.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handlePresetSelect(p)}
              className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-medium transition-all flex items-center space-x-1.5 hover:border-cyan-500/50"
            >
              {p.type === 'video_short' ? (
                <Video className="w-3.5 h-3.5 text-rose-400" />
              ) : p.type === 'image_hd' ? (
                <Image className="w-3.5 h-3.5 text-cyan-400" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>{p.title}</span>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        
        {/* Model Type Selector Cards */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
            Target Workflow Model
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            
            {/* Flux Schnell FP8 */}
            <button
              type="button"
              onClick={() => setMediaType('image_fast')}
              className={`p-3.5 rounded-xl border text-left transition-all relative overflow-hidden ${
                mediaType === 'image_fast'
                  ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-md shadow-cyan-950'
                  : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-xs text-slate-200">Flux Schnell FP8</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800">
                  {formatDurationBadge(durationStats, 'image_fast')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">4-Step Ultra Fast FP8 Quantized Image Generation</p>
            </button>

            {/* SDXL FP8 */}
            <button
              type="button"
              onClick={() => setMediaType('image_hd')}
              className={`p-3.5 rounded-xl border text-left transition-all relative overflow-hidden ${
                mediaType === 'image_hd'
                  ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-md shadow-cyan-950'
                  : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <Image className="w-4 h-4 text-cyan-400" />
                  <span className="font-bold text-xs text-slate-200">SDXL HD FP8</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {formatDurationBadge(durationStats, 'image_hd')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">25-Step High Detail Quality Diffusion Render</p>
            </button>

            {/* SVD Video */}
            <button
              type="button"
              onClick={() => setMediaType('video_short')}
              className={`p-3.5 rounded-xl border text-left transition-all relative overflow-hidden ${
                mediaType === 'video_short'
                  ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-md shadow-cyan-950'
                  : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <Video className="w-4 h-4 text-rose-400" />
                  <span className="font-bold text-xs text-slate-200">Quantized SVD</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-950 text-rose-300 border border-rose-800">
                  {formatDurationBadge(durationStats, 'video_short')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">16-Frame Fluid Video Render (832x480 Optimized) - requires a reference image below</p>
            </button>

          </div>
        </div>

        {/* Prompt Input Area */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
            Diffusion Prompt
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the visual scene in vivid detail..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all font-sans resize-none"
          />
        </div>

        {/* Reference Image Upload */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
            Reference Image {needsReferenceImage ? <span className="text-rose-400">(Required for Video)</span> : <span className="text-slate-500 normal-case font-normal">(optional)</span>}
          </label>
          {!needsReferenceImage && mediaType === 'image_hd' && (
            <p className="text-[11px] text-slate-500 -mt-1 mb-2">
              Face-ID regeneration: the whole photo is regenerated into your new scene (new
              pose, lighting, everything) while an identity model keeps faces recognizable.
              Slower than a normal render - the model streams extra face-ID weights too.
            </p>
          )}
          {!needsReferenceImage && mediaType === 'image_fast' && (
            <p className="text-[11px] text-slate-500 -mt-1 mb-2">
              Face-safe scene swap: people in the photo are segmented out and pasted back
              pixel-for-pixel onto a newly generated scene from your prompt - faces are never
              re-diffused, so they stay exactly as uploaded but keep their original pose.
              Switch to SDXL HD above for full regeneration with a different pose/angle.
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />

          {previewUrl ? (
            <div className="flex items-center space-x-3 p-3 bg-slate-950 border border-slate-800 rounded-xl">
              <img src={previewUrl} alt="Reference preview" className="w-16 h-16 object-cover rounded-lg border border-slate-800" />
              <div className="flex-1 min-w-0">
                {isUploading ? (
                  <span className="text-xs text-cyan-300 flex items-center space-x-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Uploading...</span>
                  </span>
                ) : uploadedImageUrl ? (
                  <span className="text-xs text-emerald-400 flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="truncate">Uploaded ({uploadedWidth}×{uploadedHeight})</span>
                  </span>
                ) : (
                  <span className="text-xs text-rose-400">{uploadError || 'Upload failed'}</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleRemoveImage}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0"
                title="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`w-full py-4 rounded-xl border border-dashed flex flex-col items-center justify-center space-y-1.5 transition-all ${
                needsReferenceImage
                  ? 'border-rose-800/60 bg-rose-950/20 hover:border-rose-600 text-rose-300'
                  : 'border-slate-800 bg-slate-950/60 hover:border-cyan-500/50 text-slate-400'
              }`}
            >
              <ImagePlus className="w-5 h-5" />
              <span className="text-xs font-medium">Click to upload a reference image</span>
            </button>
          )}
        </div>

        {/* Controls Row: Aspect Ratio & Seed */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          {/* Aspect Ratio Picker */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Aspect Ratio
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['1:1', '16:9', '9:16'] as AspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                    aspectRatio === ratio
                      ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <Ratio className="w-3.5 h-3.5" />
                  <span>{ratio}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Seed Input & Randomizer */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Seed Number
            </label>
            <div className="flex space-x-2">
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleRandomizeSeed}
                title="Randomize Seed"
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-300 transition-all"
              >
                <Shuffle className="w-4 h-4 text-cyan-400" />
              </button>
            </div>
          </div>

        </div>

        {/* GPU Unavailable / Insufficient VRAM Hard Block */}
        {(gpuUnavailable || vramCritical) && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/70 text-rose-200 text-xs gap-3 shadow-lg">
            <div className="flex items-start space-x-2.5">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block text-rose-100">
                  {gpuUnavailable ? 'GPU Telemetry Offline' : 'Insufficient Free VRAM for Model'}
                </span>
                <span className="text-[11px] text-rose-300/90">
                  {gpuUnavailable
                    ? 'GPU telemetry unavailable - cannot verify VRAM, so rendering is disabled.'
                    : `This model requires at least ${requiredVramMb} MB free VRAM, but only ${freeVramMb} MB is currently available. Previous weights or torch memory are still loaded.`}
                </span>
              </div>
            </div>

            {vramCritical && onFreeVram && (
              <button
                type="button"
                onClick={onFreeVram}
                disabled={isFreeingVram}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-extrabold rounded-xl text-xs shrink-0 flex items-center justify-center space-x-2 transition-all shadow-lg active:scale-95 disabled:opacity-50 ring-2 ring-rose-400/30 tracking-wide"
              >
                <Trash2 className={`w-4 h-4 ${isFreeingVram ? 'animate-spin' : ''}`} />
                <span>{isFreeingVram ? 'FREEING VRAM...' : 'FREE VRAM NOW'}</span>
              </button>
            )}
          </div>
        )}

        {referenceImageMissing && !gpuUnavailable && !vramCritical && (
          <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Quantized SVD is image-to-video - upload a reference image above before rendering.</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={submitBlocked}
          className={`w-full py-3.5 px-6 rounded-xl font-bold text-sm tracking-wide transition-all shadow-lg flex items-center justify-center space-x-2 ${
            submitBlocked
              ? 'bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-cyan-500/20 active:scale-[0.99]'
          }`}
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <span>GPU Execution In Progress...</span>
            </>
          ) : gpuUnavailable ? (
            <span>GPU Telemetry Unavailable</span>
          ) : vramCritical ? (
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Insufficient VRAM ({freeVramMb} MB Free / {requiredVramMb} MB Needed) — Clear VRAM Above</span>
            </div>
          ) : isUploading ? (
            <span>Uploading Reference Image...</span>
          ) : referenceImageMissing ? (
            <span>Upload a Reference Image First</span>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current text-white" />
              <span>Trigger Local RTX 3060 Ti ComfyUI Render</span>
            </>
          )}
        </button>

      </form>
    </div>
  );
};
