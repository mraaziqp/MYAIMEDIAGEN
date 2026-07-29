import React, { useState } from 'react';
import { Sparkles, Zap, Video, Image, Shuffle, Ratio, Play, ShieldAlert } from 'lucide-react';
import { MediaType, AspectRatio, WorkflowParams, SystemStats } from '../types';

interface GeneratorPanelProps {
  onGenerate: (params: WorkflowParams) => void;
  isGenerating: boolean;
  stats: SystemStats | null;
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
    type: 'image_hd' as MediaType,
    aspect: '1:1' as AspectRatio,
    prompt: 'Ultra HD realistic macro shot of a metallic mechanical hummingbird with glowing sapphire wings and brass gear clockwork details',
  },
  {
    title: 'Autumn Mountain Drone',
    type: 'video_short' as MediaType,
    aspect: '16:9' as AspectRatio,
    prompt: 'AnimateDiff cinematic drone shot flying over misty autumn mountains, golden hour light, 16 frames fluid motion',
  },
  {
    title: 'Sci-Fi Cyber Android',
    type: 'image_hd' as MediaType,
    aspect: '9:16' as AspectRatio,
    prompt: 'Futuristic sci-fi android concept art, glowing neon blue neural circuits, octane render, studio lighting, highly detailed portrait',
  },
];

export const GeneratorPanel: React.FC<GeneratorPanelProps> = ({
  onGenerate,
  isGenerating,
  stats,
}) => {
  const [prompt, setPrompt] = useState(
    'Cyberpunk neon alleyway in neo-Tokyo with rain reflections, glowing signs, cinematic 8k, photorealistic'
  );
  const [mediaType, setMediaType] = useState<MediaType>('image_fast');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [seed, setSeed] = useState<number>(Math.floor(Math.random() * 900000) + 100000);
  const [customSteps, setCustomSteps] = useState<number | ''>('');

  const handleRandomizeSeed = () => {
    setSeed(Math.floor(Math.random() * 900000) + 100000);
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

  const gpuUnavailable = !stats;
  const vramCritical = !!stats && freeVramMb < requiredVramMb;
  const submitBlocked = isGenerating || !prompt.trim() || gpuUnavailable || vramCritical;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitBlocked) return;

    onGenerate({
      prompt,
      mediaType,
      aspectRatio,
      seed: Number(seed),
      steps: customSteps ? Number(customSteps) : undefined,
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
                  ~1.5s
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
                  ~3.8s
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
                  ~8.5s
                </span>
              </div>
              <p className="text-[11px] text-slate-400">16-Frame Fluid Video Render (832x480 Optimized)</p>
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

        {/* GPU Unavailable / Insufficient VRAM Hard Block - mirrors the backend's OOM guardrail exactly */}
        {(gpuUnavailable || vramCritical) && (
          <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              {gpuUnavailable
                ? 'GPU telemetry unavailable - cannot verify VRAM, so rendering is disabled.'
                : `Free VRAM (${freeVramMb} MB) is below the ${requiredVramMb} MB this model needs - rendering is disabled to prevent an OOM crash. Try "Free VRAM" above, or pick a lighter model.`}
            </span>
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
            <span>Insufficient VRAM ({freeVramMb} MB Free)</span>
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
