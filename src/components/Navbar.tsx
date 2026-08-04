import React from 'react';
import { Cpu, ShieldCheck, Radio, Sparkles, Terminal, Database, Sliders, Layers } from 'lucide-react';
import { SystemStats } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  systemStats: SystemStats | null;
  onRefreshStats: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  systemStats,
  onRefreshStats,
}) => {
  const isOnline = systemStats?.status === 'ONLINE';
  const vramPct = systemStats?.vramUsagePercent || 0;

  return (
    <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Left Logo / Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Cpu className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-cyan-400 via-blue-300 to-indigo-200 bg-clip-text text-transparent">
                  Local AI Media Gateway
                </span>
                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                  RTX 3060 Ti (8GB)
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Cloud-to-Local ComfyUI Hub & Function Calling Gateway
              </p>
            </div>
          </div>

          {/* Center Tabs Navigation */}
          <nav className="hidden md:flex items-center space-x-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'generate'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Studio Generator</span>
            </button>

            <button
              onClick={() => setActiveTab('gallery')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'gallery'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Vault Gallery</span>
            </button>

            <button
              onClick={() => setActiveTab('tools')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'tools'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>AI Studio Schema</span>
            </button>

            <button
              onClick={() => setActiveTab('workflows')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'workflows'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Workflows</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'settings'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Worker Status</span>
            </button>
          </nav>

          {/* Right Status Badges & VRAM Quick Meter */}
          <div className="flex items-center space-x-3">
            
            {/* Encryption & Security Indicator */}
            <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>AES-256 Vault</span>
            </div>

            {/* ComfyUI Connection Badge */}
            <button
              onClick={onRefreshStats}
              title="Click to re-ping ComfyUI system_stats"
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                isOnline
                  ? 'bg-slate-900 border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-950'
                  : 'bg-rose-950/40 border-rose-800 text-rose-300'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${isOnline ? 'text-emerald-400 animate-pulse' : 'text-rose-400'}`} />
              <span>{isOnline ? 'ComfyUI Connected' : 'Worker Offline'}</span>
            </button>

            {/* VRAM Quick Pill */}
            {systemStats && (
              <div className="hidden sm:flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
                <span className="text-slate-400">VRAM:</span>
                <div className="w-16 bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
                  <div
                    className={`h-full transition-all duration-500 ${
                      vramPct > 85 ? 'bg-rose-500' : vramPct > 70 ? 'bg-amber-400' : 'bg-cyan-400'
                    }`}
                    style={{ width: `${vramPct}%` }}
                  />
                </div>
                <span className="font-mono text-cyan-300 font-semibold">{vramPct}%</span>
              </div>
            )}

          </div>

        </div>
      </div>

      {/* Mobile Tab Navigation Sub-bar */}
      <div className="md:hidden flex items-center justify-around bg-slate-900 px-2 py-2 border-t border-slate-800 text-xs">
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
