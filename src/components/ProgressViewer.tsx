import React, { useEffect, useState } from 'react';
import { Activity, Clock, Cpu, Octagon, CheckCircle2, AlertTriangle, ShieldCheck, XCircle, Download, Share2, Check } from 'lucide-react';
import { StreamProgressEvent } from '../types';
import { filenameFromMediaUrl, shareMedia } from '../lib/mediaShare';

interface ProgressViewerProps {
  promptId: string;
  onCompleted: (mediaUrl: string) => void;
  onInterrupt: () => void;
}

export const ProgressViewer: React.FC<ProgressViewerProps> = ({
  promptId,
  onCompleted,
  onInterrupt,
}) => {
  const [event, setEvent] = useState<StreamProgressEvent>({
    promptId,
    status: 'processing',
    node: 'Initialization',
    nodeTitle: 'Connecting to RTX 3060 Ti Gateway...',
    step: 0,
    maxSteps: 100,
    percentage: 5,
    etaSeconds: 5,
    vramCurrentMb: 4100,
  });

  const [isDone, setIsDone] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'shared' | 'copied'>('idle');

  const handleShare = async (mediaUrl: string) => {
    setShareState('sharing');
    const result = await shareMedia(mediaUrl);
    if (result === 'shared' || result === 'copied') {
      setShareState(result);
      setTimeout(() => setShareState('idle'), 2000);
    } else {
      setShareState('idle');
    }
  };

  useEffect(() => {
    if (!promptId) return;

    const eventSource = new EventSource(`/api/stream/${promptId}`);

    eventSource.onmessage = (e) => {
      try {
        const data: StreamProgressEvent = JSON.parse(e.data);
        if (data && data.status) {
          setEvent(data);
          if (data.status === 'completed') {
            setIsDone(true);
            if (data.mediaUrl) {
              onCompleted(data.mediaUrl);
            }
            eventSource.close();
          } else if (data.status === 'failed' || data.status === 'interrupted') {
            setIsDone(true);
            eventSource.close();
          }
        }
      } catch (err) {
        // ignore JSON parse error
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [promptId, onCompleted]);

  return (
    <div className="bg-slate-900/95 border border-cyan-500/40 rounded-2xl p-5 sm:p-6 shadow-2xl shadow-cyan-950/40 text-slate-100 relative overflow-hidden">
      
      {/* Background Subtle Pulse Effect */}
      <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-700 text-cyan-400">
            <Activity className="w-5 h-5 animate-spin" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-slate-100">Live ComfyUI Pipeline Streaming</h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                {promptId.slice(0, 18)}
              </span>
            </div>
            <p className="text-xs text-cyan-300 font-semibold">{event.nodeTitle || event.node}</p>
          </div>
        </div>

        {/* Interrupt / Cancel Button */}
        {!isDone && (
          <button
            onClick={onInterrupt}
            className="px-3.5 py-1.5 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-800/80 text-rose-300 text-xs font-bold transition-all flex items-center space-x-1.5 shadow-lg shadow-rose-950/50"
          >
            <Octagon className="w-4 h-4 fill-rose-500/20 text-rose-400" />
            <span>Interrupt GPU Job</span>
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between items-center text-xs font-mono mb-1.5">
          <span className="text-slate-400">
            Step {event.step} / {event.maxSteps}
          </span>
          <span className="text-cyan-300 font-bold">{event.percentage}%</span>
        </div>
        <div className="w-full bg-slate-950 rounded-full h-4 p-0.5 border border-slate-800 overflow-hidden relative">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 rounded-full transition-all duration-300 shadow-lg shadow-cyan-500/30"
            style={{ width: `${event.percentage}%` }}
          />
        </div>
      </div>

      {/* Metrics Row: ETA, Current Node, VRAM */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-3 font-mono">
        
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
          <span className="text-slate-400 text-[10px] uppercase font-sans block font-semibold">ETA Remaining</span>
          <div className="flex items-center space-x-1.5 text-cyan-300 mt-0.5 font-bold">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{event.etaSeconds}s</span>
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
          <span className="text-slate-400 text-[10px] uppercase font-sans block font-semibold">Allocated VRAM</span>
          <div className="flex items-center space-x-1.5 text-indigo-300 mt-0.5 font-bold">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>{(event.vramCurrentMb / 1024).toFixed(2)} GB</span>
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 col-span-2 sm:col-span-1">
          <span className="text-slate-400 text-[10px] uppercase font-sans block font-semibold">Status</span>
          <div className="flex items-center space-x-1 mt-0.5 font-bold">
            {event.status === 'completed' ? (
              <span className="text-emerald-400 flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> <span>Render Complete</span>
              </span>
            ) : event.status === 'interrupted' ? (
              <span className="text-rose-400 flex items-center space-x-1">
                <AlertTriangle className="w-3.5 h-3.5" /> <span>Halted</span>
              </span>
            ) : event.status === 'failed' ? (
              <span className="text-rose-400 flex items-center space-x-1">
                <XCircle className="w-3.5 h-3.5" /> <span>Failed</span>
              </span>
            ) : (
              <span className="text-cyan-400 flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> <span>GPU Active</span>
              </span>
            )}
          </div>
        </div>

      </div>

      {/* Final Completed Artifact Preview */}
      {event.status === 'completed' && event.mediaUrl && (
        <div className="mt-4 p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-300">
              GPU Generation Complete — Encrypted Asset Vaulted
            </span>
          </div>
          {event.mediaUrl.endsWith('.mp4') ? (
            <video
              src={event.mediaUrl}
              controls
              autoPlay
              loop
              className="w-full max-h-72 object-cover rounded-lg border border-slate-800"
            />
          ) : (
            <img
              src={event.mediaUrl}
              alt="Render Output"
              className="w-full max-h-72 object-cover rounded-lg border border-slate-800"
            />
          )}

          <div className="flex items-center space-x-2 mt-3">
            <a
              href={event.mediaUrl}
              download={filenameFromMediaUrl(event.mediaUrl)}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Download</span>
            </a>
            <button
              onClick={() => handleShare(event.mediaUrl!)}
              disabled={shareState === 'sharing'}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
            >
              {shareState === 'shared' || shareState === 'copied' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{shareState === 'copied' ? 'Link Copied' : 'Shared'}</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5 text-fuchsia-400" />
                  <span>{shareState === 'sharing' ? 'Sharing...' : 'Share'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error / Interrupted / Failed Banner */}
      {(event.status === 'interrupted' || event.status === 'failed') && (
        <div className="mt-3 p-3 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs">
          {event.error ||
            (event.status === 'interrupted' ? 'Pipeline halted via user interrupt request.' : 'GPU execution failed.')}
        </div>
      )}
    </div>
  );
};
