import React, { useState } from 'react';
import { Layers, Download, Copy, Check, Zap, Image, Video, FileCode } from 'lucide-react';
import { MediaType, AspectRatio } from '../types';
import { buildComfyWorkflow } from '../gateway/workflowMapper';

export const WorkflowInspector: React.FC = () => {
  const [selectedMediaType, setSelectedMediaType] = useState<MediaType>('image_fast');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>('16:9');
  const [prompt, setPrompt] = useState('Cyberpunk neon alleyway in neo-Tokyo with rain reflections, glowing signs, cinematic 8k');
  const [copied, setCopied] = useState(false);

  const { workflow, seed, dimensions } = buildComfyWorkflow({
    prompt,
    mediaType: selectedMediaType,
    aspectRatio: selectedAspectRatio,
  });

  const workflowJson = JSON.stringify(workflow, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(workflowJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadUrl = `/api/workflow-download?mediaType=${selectedMediaType}&aspectRatio=${selectedAspectRatio}&prompt=${encodeURIComponent(
    prompt
  )}`;

  return (
    <div className="space-y-6 text-slate-100">
      
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">ComfyUI Workflow Mapper Inspector</h2>
            <p className="text-xs text-slate-400">Dynamic API JSON generator tuned for RTX 3060 Ti (8GB VRAM limit)</p>
          </div>
        </div>

        <a
          href={downloadUrl}
          download={`workflow_${selectedMediaType}_api.json`}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all flex items-center space-x-2 shadow-md"
        >
          <Download className="w-4 h-4" />
          <span>Download workflow_api.json</span>
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left: Controls */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
            <FileCode className="w-4 h-4 text-cyan-400" />
            <span>Workflow Parameters</span>
          </h3>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Model Workflow Architecture
            </label>
            <div className="space-y-2">
              <button
                onClick={() => setSelectedMediaType('image_fast')}
                className={`w-full p-3 rounded-xl border text-left text-xs font-bold flex items-center justify-between transition-all ${
                  selectedMediaType === 'image_fast'
                    ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Flux Schnell FP8 (4 Steps)</span>
                </div>
                <span className="font-mono text-[10px] text-slate-500">~4.2GB VRAM</span>
              </button>

              <button
                onClick={() => setSelectedMediaType('image_hd')}
                className={`w-full p-3 rounded-xl border text-left text-xs font-bold flex items-center justify-between transition-all ${
                  selectedMediaType === 'image_hd'
                    ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Image className="w-4 h-4 text-cyan-400" />
                  <span>SDXL HD FP8 (25 Steps)</span>
                </div>
                <span className="font-mono text-[10px] text-slate-500">~5.8GB VRAM</span>
              </button>

              <button
                onClick={() => setSelectedMediaType('video_short')}
                className={`w-full p-3 rounded-xl border text-left text-xs font-bold flex items-center justify-between transition-all ${
                  selectedMediaType === 'video_short'
                    ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Video className="w-4 h-4 text-rose-400" />
                  <span>Quantized SVD Video (16 Frames)</span>
                </div>
                <span className="font-mono text-[10px] text-slate-500">~6.8GB VRAM</span>
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Dimensions & Aspect Ratio
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['1:1', '16:9', '9:16'] as AspectRatio[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedAspectRatio(r)}
                  className={`py-2 px-2 rounded-xl border text-xs font-bold transition-all ${
                    selectedAspectRatio === r
                      ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2 font-mono">
              Calculated Dimensions: <strong className="text-cyan-300">{dimensions.width} x {dimensions.height} px</strong>
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              Sample Prompt
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 resize-none font-sans"
            />
          </div>

        </div>

        {/* Right 2 Cols: Interactive Workflow JSON Code Viewer */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-200">Generated workflow_api.json Payload</h3>
                <p className="text-xs text-slate-400">Directly compatible with ComfyUI REST API <code className="text-cyan-400 font-mono">POST /prompt</code></p>
              </div>

              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all flex items-center space-x-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy JSON'}</span>
              </button>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-cyan-300 overflow-x-auto max-h-[480px] shadow-inner">
              <pre>{workflowJson}</pre>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800/80 text-xs text-slate-500 font-mono flex justify-between">
            <span>Injected Seed: {seed}</span>
            <span>Optimized for 8GB VRAM</span>
          </div>
        </div>

      </div>

    </div>
  );
};
