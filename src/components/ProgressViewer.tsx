import React, { useEffect, useRef, useState } from 'react';
import { Activity, Clock, Cpu, Octagon, CheckCircle2, AlertTriangle, ShieldCheck, XCircle, Download, Share2, Check, ImagePlus, X, WifiOff, RefreshCw } from 'lucide-react';
import { StreamProgressEvent } from '../types';
import { filenameFromMediaUrl, shareMedia } from '../lib/mediaShare';

const INITIAL_EVENT: Omit<StreamProgressEvent, 'promptId'> = {
  status: 'processing',
  node: 'Initialization',
  nodeTitle: 'Connecting to RTX 3060 Ti Gateway...',
  step: 0,
  maxSteps: 100,
  percentage: 5,
};

// Capped exponential backoff for SSE reconnect attempts (1s, 2s, 4s, 8s, 8s...) - a dropped
// connection (dev server restart, brief network blip) shouldn't just freeze the progress
// card forever, but hammering the gateway on every retry isn't right either.
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 8000;

type ConnectionState = 'live' | 'reconnecting' | 'lost';

interface ProgressViewerProps {
  promptId: string;
  onTerminal: (event: StreamProgressEvent) => void;
  onInterrupt: () => void;
  onViewGallery: () => void;
  onDismiss: () => void;
}

export const ProgressViewer: React.FC<ProgressViewerProps> = ({
  promptId,
  onTerminal,
  onInterrupt,
  onViewGallery,
  onDismiss,
}) => {
  const [event, setEvent] = useState<StreamProgressEvent>({ promptId, ...INITIAL_EVENT });

  const [isDone, setIsDone] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'shared' | 'copied'>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>('live');
  // Bumped by the "Reconnect" banner button to force the SSE effect below to tear down and
  // reconnect from scratch (attempts reset to 0) without a full page reload.
  const [retryNonce, setRetryNonce] = useState(0);

  // The gateway now reports real elapsedMs on every event (see comfyService.ts) - this
  // anchors the visible per-second ticker to that authoritative value between events, rather
  // than drifting from a purely client-side clock that has no idea what actually happened
  // server-side (e.g. across a reconnect).
  const serverElapsedRef = useRef<{ ms: number; receivedAt: number } | null>(null);
  const localStartRef = useRef<number>(Date.now());

  // A new promptId means a fresh job (either a brand new trigger, or reattaching after a
  // refresh) - reset local state so a previous job's completed/failed card doesn't linger
  // underneath the new one, since this component instance isn't remounted when only the
  // promptId prop changes.
  useEffect(() => {
    setEvent({ promptId, ...INITIAL_EVENT });
    setIsDone(false);
    setShareState('idle');
    setConnectionState('live');
    serverElapsedRef.current = null;
    localStartRef.current = Date.now();
    setElapsedSeconds(0);
  }, [promptId]);

  // Ticks independently of server events so the UI visibly proves it's alive during the
  // long model-streaming phase, where no server progress event may arrive for a while.
  // Anchored to the last real server elapsedMs when one is available so it stays accurate
  // (including across a reconnect) instead of just counting up from when this component
  // instance happened to mount.
  useEffect(() => {
    if (isDone) return;
    const interval = setInterval(() => {
      if (serverElapsedRef.current) {
        const { ms, receivedAt } = serverElapsedRef.current;
        setElapsedSeconds(Math.round((ms + (Date.now() - receivedAt)) / 1000));
      } else {
        setElapsedSeconds(Math.round((Date.now() - localStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [promptId, isDone]);

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

    // Plain local variables, not React state - the reconnect/backoff logic below needs an
    // always-current view of "have we already finished/given up" inside closures that are
    // created once per connect() call, which stale state from the outer render wouldn't give.
    let settled = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let eventSource: EventSource;

    const connect = () => {
      eventSource = new EventSource(`/api/stream/${promptId}`);

      eventSource.onopen = () => {
        attempts = 0;
        setConnectionState('live');
      };

      eventSource.onmessage = (e) => {
        try {
          const data: StreamProgressEvent = JSON.parse(e.data);
          if (data && data.status) {
            setEvent(data);
            setConnectionState('live');
            if (typeof data.elapsedMs === 'number') {
              serverElapsedRef.current = { ms: data.elapsedMs, receivedAt: Date.now() };
              setElapsedSeconds(Math.round(data.elapsedMs / 1000));
            }
            if (data.status === 'completed' || data.status === 'failed' || data.status === 'interrupted') {
              settled = true;
              setIsDone(true);
              onTerminal(data);
              eventSource.close();
            }
          }
        } catch (err) {
          // ignore JSON parse error
        }
      };

      eventSource.onerror = () => {
        if (settled) return;
        eventSource.close();
        attempts += 1;

        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          setConnectionState('lost');
          return;
        }

        setConnectionState('reconnecting');
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempts - 1), RECONNECT_MAX_DELAY_MS);
        reconnectTimer = setTimeout(() => {
          if (!settled) connect();
        }, delay);
      };
    };

    connect();

    return () => {
      settled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSource?.close();
    };
  }, [promptId, onTerminal, retryNonce]);

  const handleManualReconnect = () => {
    setConnectionState('reconnecting');
    setRetryNonce((n) => n + 1);
  };

  return (
    <div className="bg-slate-900/95 border border-cyan-500/40 rounded-2xl p-5 sm:p-6 shadow-2xl shadow-cyan-950/40 text-slate-100 relative overflow-hidden">
      
      {/* Background Subtle Pulse Effect */}
      <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Connection State Banner - shown whenever the SSE stream to the gateway itself has
          dropped, so a network blip reads as "reconnecting" instead of a silently frozen
          progress bar. The GPU job keeps running regardless; this only reflects whether we're
          still watching it live. */}
      {!isDone && connectionState !== 'live' && (
        <div
          className={`mb-4 p-3 rounded-xl border text-xs flex items-center justify-between ${
            connectionState === 'reconnecting'
              ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
          }`}
        >
          <span className="flex items-center space-x-2">
            {connectionState === 'reconnecting' ? (
              <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <WifiOff className="w-4 h-4 shrink-0" />
            )}
            <span>
              {connectionState === 'reconnecting'
                ? 'Reconnecting to gateway... the GPU job keeps running regardless.'
                : 'Lost connection to the gateway. The job may still be running on the GPU - check the Vault Gallery, or retry below.'}
            </span>
          </span>
          {connectionState === 'lost' && (
            <button
              onClick={handleManualReconnect}
              className="ml-3 px-2.5 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-900 border border-rose-800 text-rose-200 font-bold shrink-0 transition-all"
            >
              Retry
            </button>
          )}
        </div>
      )}

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

        {/* Interrupt while running, Dismiss once the job has reached a terminal state */}
        {!isDone ? (
          <button
            onClick={onInterrupt}
            className="px-3.5 py-1.5 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-800/80 text-rose-300 text-xs font-bold transition-all flex items-center space-x-1.5 shadow-lg shadow-rose-950/50"
          >
            <Octagon className="w-4 h-4 fill-rose-500/20 text-rose-400" />
            <span>Interrupt GPU Job</span>
          </button>
        ) : (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-all"
          >
            <X className="w-4 h-4" />
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
          <span className="text-slate-400 text-[10px] uppercase font-sans block font-semibold">
            {event.etaSeconds !== undefined ? 'ETA Remaining' : 'Elapsed'}
          </span>
          <div className="flex items-center space-x-1.5 text-cyan-300 mt-0.5 font-bold">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{event.etaSeconds !== undefined ? `${event.etaSeconds}s` : `${elapsedSeconds}s`}</span>
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
          <span className="text-slate-400 text-[10px] uppercase font-sans block font-semibold">Allocated VRAM</span>
          <div className="flex items-center space-x-1.5 text-indigo-300 mt-0.5 font-bold">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>{event.vramCurrentMb !== undefined ? `${(event.vramCurrentMb / 1024).toFixed(2)} GB` : '—'}</span>
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

          <button
            onClick={onViewGallery}
            className="w-full mt-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center space-x-1.5 transition-all shadow-lg shadow-emerald-950/50"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            <span>View in Vault Gallery</span>
          </button>
        </div>
      )}

      {/* Error / Interrupted / Failed Banner */}
      {(event.status === 'interrupted' || event.status === 'failed') && (
        <div className="mt-3 p-3 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs">
          <p className="mb-2">
            {event.error ||
              (event.status === 'interrupted' ? 'Pipeline halted via user interrupt request.' : 'GPU execution failed.')}
          </p>
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-900 border border-rose-800 text-rose-200 text-xs font-bold transition-all"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
