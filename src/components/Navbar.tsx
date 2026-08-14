import React from 'react';
import { Cpu, ShieldCheck, Radio, Sparkles, Terminal, Database, Sliders, Layers, Trash2 } from 'lucide-react';
import { SystemStats } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  systemStats: SystemStats | null;
  onRefreshStats: () => void;
  onFreeVram?: () => void;
  isFreeingVram?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  systemStats,
  onRefreshStats,
  onFreeVram,
  isFreeingVram,
}) => {
  const isOnline = systemStats?.status === 'ONLINE';
  const vramPct = systemStats?.vramUsagePercent || 0;
  const freeVramGb = systemStats ? (systemStats.vramFreeMb / 1024).toFixed(1) : null;
  const isLowVram = systemStats ? systemStats.vramFreeMb < 3800 : false;

  return (
    <header className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 text-slate-100 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          
          {/* Left Brand / Logo */}
          <div className="flex items-center space-x-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 shrink-0">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-cyan-300 via-sky-200 to-indigo-200 bg-clip-text text-transparent whitespace-nowrap">
                  Local AI Gateway
                </span>
                <span className="hidden xl:inline-flex px-2 py-0.5 text-[10px] font-semibold tracking-wide rounded-full bg-cyan-950/90 text-cyan-300 border border-cyan-800/80 whitespace-nowrap">
                  RTX 3060 Ti
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-normal hidden lg:block tracking-tight">
                ComfyUI Hub & Function Calling Gateway
              </span>
            </div>
          </div>

          {/* Center Tabs Navigation */}
          <nav className="hidden md:flex items-center space-x-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 shadow-inner">
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'generate'
                  ? 'bg-gradient-to-r from-cyan-500/25 to-blue-500/25 text-cyan-200 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Studio Generator</span>
            </button>

            <button
              onClick={() => setActiveTab('gallery')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'gallery'
                  ? 'bg-gradient-to-r from-cyan-500/25 to-blue-500/25 text-cyan-200 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Vault Gallery</span>
            </button>

            <button
              onClick={() => setActiveTab('tools')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'tools'
                  ? 'bg-gradient-to-r from-cyan-500/25 to-blue-500/25 text-cyan-200 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>AI Schema</span>
            </button>

            <button
              onClick={() => setActiveTab('workflows')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'workflows'
                  ? 'bg-gradient-to-r from-cyan-500/25 to-blue-500/25 text-cyan-200 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Workflows</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-cyan-500/25 to-blue-500/25 text-cyan-200 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Worker Status</span>
            </button>
          </nav>

          {/* Right Status Badges & VRAM Quick Actions */}
          <div className="flex items-center space-x-2 shrink-0">
            
            {/* Encryption & Security Indicator */}
            <div className="hidden 2xl:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-400 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>AES-256</span>
            </div>

            {/* ComfyUI Connection Badge */}
            <button
              onClick={onRefreshStats}
              title="Click to re-ping ComfyUI telemetry"
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                isOnline
                  ? 'bg-slate-900 border-emerald-500/40 text-emerald-300 hover:bg-slate-800/80 shadow-sm'
                  : 'bg-rose-950/50 border-rose-800 text-rose-300 hover:bg-rose-900/50'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${isOnline ? 'text-emerald-400 animate-pulse' : 'text-rose-400'}`} />
              <span className="hidden sm:inline">{isOnline ? 'ComfyUI Online' : 'Worker Offline'}</span>
              <span className="sm:hidden">{isOnline ? 'Online' : 'Offline'}</span>
            </button>

            {/* VRAM Meter & Quick Clear Action */}
            {systemStats && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-300 shadow-inner">
                <span className="text-slate-400 text-[11px] font-medium hidden sm:inline">VRAM</span>
                <div className="w-12 sm:w-16 bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      vramPct > 85
                        ? 'bg-rose-500'
                        : vramPct > 70
                        ? 'bg-amber-400'
                        : 'bg-gradient-to-r from-cyan-400 to-blue-500'
                    }`}
                    style={{ width: `${vramPct}%` }}
                  />
                </div>
                <span
                  className={`font-mono font-bold text-xs ${
                    isLowVram ? 'text-amber-400' : 'text-cyan-300'
                  }`}
                  title={`${freeVramGb} GB free`}
                >
                  {vramPct}%
                </span>

                {/* Quick Clear VRAM button in header */}
                {onFreeVram && (
                  <button
                    onClick={onFreeVram}
                    disabled={isFreeingVram}
                    className={`ml-1 p-1 rounded-md transition-all text-xs flex items-center ${
                      isLowVram
                        ? 'bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700/60 animate-pulse'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                    }`}
                    title="Unload models & clear PyTorch CUDA VRAM cache"
                  >
                    <Trash2 className={`w-3 h-3 ${isFreeingVram ? 'animate-spin text-cyan-400' : ''}`} />
                    <span className="hidden xl:inline ml-1 text-[10px] font-semibold">
                      {isFreeingVram ? 'Purging...' : 'Clear'}
                    </span>
                  </button>
                )}
              </div>
            )}

          </div>

        </div>
      </div>

      {/* Mobile Tab Navigation Sub-bar */}
      <div className="md:hidden flex items-center justify-around bg-slate-900/95 px-2 py-2 border-t border-slate-800 text-xs">
        <button
          onClick={() => setActiveTab('generate')}
          className={`flex flex-col items-center py-1 px-2 ${activeTab === 'generate' ? 'text-cyan-400 font-semibold' : 'text-slate-400'}`}
        >
          <Sparkles className="w-4 h-4 mb-0.5" />
          <span>Generator</span>
        </button>
        <button
          onClick={() => setActiveTab('gallery')}
          className={`flex flex-col items-center py-1 px-2 ${activeTab === 'gallery' ? 'text-cyan-400 font-semibold' : 'text-slate-400'}`}
        >
          <Database className="w-4 h-4 mb-0.5" />
          <span>Gallery</span>
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`flex flex-col items-center py-1 px-2 ${activeTab === 'tools' ? 'text-cyan-400 font-semibold' : 'text-slate-400'}`}
        >
          <Terminal className="w-4 h-4 mb-0.5" />
          <span>Tools</span>
        </button>
        <button
          onClick={() => setActiveTab('workflows')}
          className={`flex flex-col items-center py-1 px-2 ${activeTab === 'workflows' ? 'text-cyan-400 font-semibold' : 'text-slate-400'}`}
        >
          <Layers className="w-4 h-4 mb-0.5" />
          <span>Workflows</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center py-1 px-2 ${activeTab === 'settings' ? 'text-cyan-400 font-semibold' : 'text-slate-400'}`}
        >
          <Sliders className="w-4 h-4 mb-0.5" />
          <span>Worker</span>
        </button>
      </div>
    </header>
  );
};
