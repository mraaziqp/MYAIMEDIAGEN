import React, { useState } from 'react';
import { Terminal, Copy, Check, Play, Sparkles, Code2, ArrowRight } from 'lucide-react';
import { MediaType, AspectRatio } from '../types';

const AI_STUDIO_TOOL_SCHEMA = {
  name: 'generate_local_media',
  description:
    "Triggers the local PC's RTX 3060 Ti GPU via ComfyUI to generate an image or video fully locally.",
  parameters: {
    type: 'OBJECT',
    properties: {
      prompt: {
        type: 'STRING',
        description: 'Expanded, highly detailed diffusion prompt describing the visual scene.',
      },
      media_type: {
        type: 'STRING',
        enum: ['image_fast', 'image_hd', 'video_short'],
        description:
          "Type of media to render. Use 'image_fast' for quick renders, 'image_hd' for high detail, and 'video_short' for video animations.",
      },
      aspect_ratio: {
        type: 'STRING',
        enum: ['1:1', '16:9', '9:16'],
        description: 'The target aspect ratio for the media output.',
      },
    },
    required: ['prompt', 'media_type'],
  },
};

interface ToolSchemaInspectorProps {
  onTriggerFunctionCall: (payload: { prompt: string; media_type: MediaType; aspect_ratio: AspectRatio }) => void;
}

export const ToolSchemaInspector: React.FC<ToolSchemaInspectorProps> = ({
  onTriggerFunctionCall,
}) => {
  const [copied, setCopied] = useState(false);

  // Test form state
  const [testPrompt, setTestPrompt] = useState(
    'A majestic mechanical dragon sitting on top of a mountain of glowing sapphire crystals, octane render, 8k'
  );
  const [testMediaType, setTestMediaType] = useState<MediaType>('image_hd');
  const [testAspectRatio, setTestAspectRatio] = useState<AspectRatio>('16:9');
  const [lastResponse, setLastResponse] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleCopySchema = () => {
    navigator.clipboard.writeText(JSON.stringify(AI_STUDIO_TOOL_SCHEMA, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunFunctionTest = async () => {
    setIsExecuting(true);
    try {
      const res = await fetch('/api/ai-studio/function-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'generate_local_media',
          args: {
            prompt: testPrompt,
            media_type: testMediaType,
            aspect_ratio: testAspectRatio,
          },
        }),
      });

      const data = await res.json();
      setLastResponse(data);
      onTriggerFunctionCall({
        prompt: testPrompt,
        media_type: testMediaType,
        aspect_ratio: testAspectRatio,
      });
    } catch (err: any) {
      setLastResponse({ error: 'Function Call Execution Failed', details: err?.message });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-slate-100">
      
      {/* Left: AI Studio Function Declaration Inspector */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Google AI Studio Tool Declaration</h3>
                <p className="text-xs text-slate-400">Paste into AI Studio &gt; Add Tool &gt; Function Calling</p>
              </div>
            </div>

            <button
              onClick={handleCopySchema}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center space-x-1.5 ${
                copied
                  ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                  : 'bg-cyan-950 hover:bg-cyan-900 border-cyan-800 text-cyan-300'
              }`}
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied JSON!' : 'Copy Schema'}</span>
            </button>
          </div>

          {/* JSON Code Viewer */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-cyan-300 overflow-x-auto max-h-96 shadow-inner">
            <pre>{JSON.stringify(AI_STUDIO_TOOL_SCHEMA, null, 2)}</pre>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
          <span>Target Function: <strong className="text-cyan-300">generate_local_media</strong></span>
          <span className="text-slate-500">JSON Schema Validated</span>
        </div>
      </div>

      {/* Right: Interactive Function Call Executor & Response Viewer */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
        
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-indigo-950 border border-indigo-800 text-indigo-400">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Simulate AI Studio Function Execution</h3>
            <p className="text-xs text-slate-400">Test payload delivery directly to Express Gateway API</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              Test Prompt String
            </label>
            <input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                Media Type
              </label>
              <select
                value={testMediaType}
                onChange={(e) => setTestMediaType(e.target.value as MediaType)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-cyan-300 focus:outline-none"
              >
                <option value="image_fast">image_fast (Flux FP8)</option>
                <option value="image_hd">image_hd (SDXL FP8)</option>
                <option value="video_short">video_short (Quantized SVD)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                Aspect Ratio
              </label>
              <select
                value={testAspectRatio}
                onChange={(e) => setTestAspectRatio(e.target.value as AspectRatio)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-cyan-300 focus:outline-none"
              >
                <option value="16:9">16:9 Widescreen</option>
                <option value="1:1">1:1 Square</option>
                <option value="9:16">9:16 Portrait</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleRunFunctionTest}
            disabled={isExecuting}
            className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-md shadow-cyan-950"
          >
            {isExecuting ? (
              <span>Invoking Local Gateway...</span>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Dispatch Function Call Payload</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </>
            )}
          </button>
        </div>

        {/* Function Call Response Output */}
        {lastResponse && (
          <div>
            <span className="text-[11px] font-mono text-slate-400 block mb-1">Gateway Function Response:</span>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-48 shadow-inner">
              <pre>{JSON.stringify(lastResponse, null, 2)}</pre>
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
