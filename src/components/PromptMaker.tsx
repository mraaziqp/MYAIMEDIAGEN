import React, { useState } from 'react';
import { Wand2, RefreshCw, Check, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { MediaType } from '../types';
import { craftPrompt, PromptStyle, STYLE_LABELS, CraftedPrompt } from '../lib/promptMaker';

interface PromptMakerProps {
  mediaType: MediaType;
  aspectRatio: string;
  /** Pushes the crafted text into the real generation prompt field. */
  onUsePrompt: (prompt: string) => void;
}

/**
 * Expands a plain description into a detailed generation prompt. Entirely local - no API call,
 * no key, works offline - so the discretionary choices are seeded from the idea text: the same
 * idea gives the same prompt until you re-roll, rather than changing under you on every render.
 *
 * It is model-aware because the models genuinely differ (see lib/promptMaker.ts): Flux gets
 * prose and no negative prompt, SDXL gets tags plus a negative prompt, and SVD is told plainly
 * that its workflow has no text encoder so the words cannot reach it.
 */
export const PromptMaker: React.FC<PromptMakerProps> = ({ mediaType, aspectRatio, onUsePrompt }) => {
  const [open, setOpen] = useState(false);
  const [idea, setIdea] = useState('');
  const [style, setStyle] = useState<PromptStyle>('cinematic');
  const [seed, setSeed] = useState(0);
  const [result, setResult] = useState<CraftedPrompt | null>(null);
  const [used, setUsed] = useState(false);

  const craft = (nextSeed = seed) => {
    setResult(craftPrompt({ idea, mediaType, aspectRatio, style, seed: nextSeed }));
    setUsed(false);
  };

  const handleUse = () => {
    if (!result?.prompt) return;
    onUsePrompt(result.prompt);
    setUsed(true);
  };

  return (
    <div className="rounded-xl border border-fuchsia-800/50 bg-fuchsia-950/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-fuchsia-950/30 transition-colors"
      >
        <span className="flex items-center space-x-2.5">
          <Wand2 className="w-4 h-4 text-fuchsia-400" />
          <span className="text-xs font-bold text-fuchsia-200">Prompt Maker</span>
          <span className="text-[11px] text-fuchsia-300/70 hidden sm:inline">
            Describe it plainly — get a detailed master prompt
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-fuchsia-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-fuchsia-400" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={2}
            placeholder="What do you want? e.g. my dog asleep on a windowsill in winter"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-fuchsia-500 resize-none"
          />

          <div className="flex flex-wrap gap-2">
            {(Object.keys(STYLE_LABELS) as PromptStyle[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(s)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                  style === s
                    ? 'bg-fuchsia-600 border-fuchsia-500 text-white'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-fuchsia-700'
                }`}
              >
                {STYLE_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => craft()}
              disabled={!idea.trim()}
              className="flex-1 py-2.5 px-3 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center space-x-2 transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Craft Master Prompt</span>
            </button>
            {result?.prompt && (
              <button
                type="button"
                onClick={() => {
                  const next = seed + 1;
                  setSeed(next);
                  craft(next);
                }}
                title="Keep the idea, re-roll the lighting/lens/palette choices"
                className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center space-x-1.5 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5 text-fuchsia-400" />
                <span className="hidden sm:inline">Re-roll</span>
              </button>
            )}
          </div>

          {result?.prompt && (
            <div className="space-y-2.5">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Master prompt</span>
                <p className="text-xs text-slate-200 leading-relaxed">{result.prompt}</p>
              </div>

              {result.negativePrompt && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
                    Suggested negative prompt
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-mono">{result.negativePrompt}</p>
                </div>
              )}

              {result.notes.length > 0 && (
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                  {result.notes.map((n, i) => (
                    <div key={i} className="flex items-start space-x-2">
                      <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                      <span className="text-[11px] text-slate-300 leading-snug">{n}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={handleUse}
                className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center space-x-2 transition-all"
              >
                {used ? <Check className="w-3.5 h-3.5" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{used ? 'Applied to the prompt below' : 'Use This Prompt'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
