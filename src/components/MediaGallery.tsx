import React, { useState } from 'react';
import {
  Database,
  Search,
  Lock,
  Copy,
  Check,
  Download,
  Share2,
  Film,
  Image as ImageIcon,
  Zap,
  Clock,
  Sparkles,
  Info,
  X,
  HardDrive,
  AlertOctagon,
} from 'lucide-react';
import { CloudJob } from '../types';
import { filenameFromMediaUrl, shareMedia } from '../lib/mediaShare';

interface MediaGalleryProps {
  records: CloudJob[];
  onRefresh: () => void;
}

export const MediaGallery: React.FC<MediaGalleryProps> = ({ records, onRefresh }) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<CloudJob | null>(null);
  const [shareStateById, setShareStateById] = useState<Record<string, 'sharing' | 'shared' | 'copied'>>({});

  const handleShare = async (item: CloudJob) => {
    setShareStateById((s) => ({ ...s, [item.id]: 'sharing' }));
    const result = await shareMedia(item.mediaUrl);
    if (result === 'shared' || result === 'copied') {
      setShareStateById((s) => ({ ...s, [item.id]: result }));
      setTimeout(() => setShareStateById((s) => { const next = { ...s }; delete next[item.id]; return next; }), 2000);
    } else {
      setShareStateById((s) => { const next = { ...s }; delete next[item.id]; return next; });
    }
  };

  const filteredRecords = records.filter((r) => {
    const matchesType = filterType === 'all' || r.modelType === filterType;
    const matchesSearch =
      !searchQuery ||
      r.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleCopyPrompt = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-5">
      
      {/* Header & Controls Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-slate-100">Encrypted Generation Vault</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center space-x-1">
                <Lock className="w-3 h-3" />
                <span>AES-256 Vaulted</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">Indexed local PC generation history for Second Brain & workspace bots</p>
          </div>
        </div>

        {/* Filter Tabs & Search */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          
          {/* Search Input */}
          <div className="relative w-full sm:w-48">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search prompt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Type Filter Buttons */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs w-full sm:w-auto justify-center">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filterType === 'all' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({records.length})
            </button>
            <button
              onClick={() => setFilterType('image_fast')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filterType === 'image_fast' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Fast FP8
            </button>
            <button
              onClick={() => setFilterType('image_hd')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filterType === 'image_hd' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              SDXL HD
            </button>
            <button
              onClick={() => setFilterType('video_short')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filterType === 'video_short' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              SVD Video
            </button>
          </div>

        </div>

      </div>

      {/* Grid of Records */}
      {filteredRecords.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <Sparkles className="w-8 h-8 text-slate-600 mx-auto mb-3 animate-pulse" />
          <p className="text-sm font-semibold text-slate-300">No generation records found</p>
          <p className="text-xs text-slate-500 mt-1">
            Trigger a render from the Studio Generator or clear search filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredRecords.map((item) => (
            <div
              key={item.id}
              className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-all shadow-xl group flex flex-col justify-between"
            >
              {/* Media Container */}
              <div className="relative aspect-video bg-slate-950 overflow-hidden cursor-pointer" onClick={() => setSelectedRecord(item)}>
                {!item.mediaUrl ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-rose-400/80 space-y-1.5">
                    <AlertOctagon className="w-6 h-6" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide">
                      {item.status === 'failed' ? 'Render Failed' : 'No Media'}
                    </span>
                  </div>
                ) : item.mediaUrl.endsWith('.mp4') ? (
                  <video
                    src={item.mediaUrl}
                    controls
                    loop
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <img
                    src={item.mediaUrl}
                    alt={item.prompt}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                )}

                {/* Model Type Tag */}
                <div className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-slate-950/80 backdrop-blur border border-slate-800 text-[10px] font-mono font-bold text-cyan-300 flex items-center space-x-1">
                  {item.modelType === 'video_short' ? (
                    <Film className="w-3 h-3 text-rose-400" />
                  ) : item.modelType === 'image_hd' ? (
                    <ImageIcon className="w-3 h-3 text-cyan-400" />
                  ) : (
                    <Zap className="w-3 h-3 text-amber-400" />
                  )}
                  <span>{item.modelType.toUpperCase()}</span>
                </div>

                {/* Encryption Badge Overlay */}
                <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-emerald-950/80 backdrop-blur border border-emerald-800 text-[10px] font-mono font-semibold text-emerald-300 flex items-center space-x-1">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span>AES-256</span>
                </div>
              </div>

              {/* Details Content */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-xs text-slate-200 line-clamp-2 font-medium mb-3">
                    {item.prompt}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400 mb-4">
                    <span className="flex items-center space-x-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                    </span>
                    <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      Seed: {item.seed}
                    </span>
                    <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-indigo-300">
                      VRAM: {item.vramPeakMb ? `${(item.vramPeakMb / 1024).toFixed(1)} GB` : 'n/a'}
                    </span>
                  </div>
                </div>

                {/* Action Row */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                  <button
                    onClick={() => handleCopyPrompt(item.prompt, item.id)}
                    className="text-xs text-slate-400 hover:text-cyan-300 flex items-center space-x-1 transition-colors"
                  >
                    {copiedId === item.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedId === item.id ? 'Copied' : 'Copy Prompt'}</span>
                  </button>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setSelectedRecord(item)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                      title="View Details & Metadata"
                    >
                      <Info className="w-3.5 h-3.5 text-cyan-400" />
                    </button>
                    {item.mediaUrl && (
                      <>
                        <button
                          onClick={() => handleShare(item)}
                          disabled={shareStateById[item.id] === 'sharing'}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-300 transition-colors"
                          title="Share"
                        >
                          {shareStateById[item.id] === 'shared' || shareStateById[item.id] === 'copied' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Share2 className="w-3.5 h-3.5 text-fuchsia-400" />
                          )}
                        </button>
                        <a
                          href={item.mediaUrl}
                          download={filenameFromMediaUrl(item.mediaUrl)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          title="Download Asset"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-300" />
                        </a>
                      </>
                    )}
                  </div>
                </div>

              </div>

            </div>
          ))}
        </div>
      )}

      {/* Metadata Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative text-slate-100 max-h-[90vh] overflow-y-auto">
            
            <button
              onClick={() => setSelectedRecord(null)}
              className="absolute top-4 right-4 p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold mb-4 flex items-center space-x-2">
              <Info className="w-5 h-5 text-cyan-400" />
              <span>Generation Metadata & Encryption Inspector</span>
            </h3>

            {/* Media Preview */}
            <div className="mb-4 rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
              {!selectedRecord.mediaUrl ? (
                <div className="w-full h-48 flex flex-col items-center justify-center text-rose-400/80 space-y-2">
                  <AlertOctagon className="w-8 h-8" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    {selectedRecord.status === 'failed' ? 'Render Failed - No Media Produced' : 'No Media'}
                  </span>
                </div>
              ) : selectedRecord.mediaUrl.endsWith('.mp4') ? (
                <video src={selectedRecord.mediaUrl} controls autoPlay loop className="w-full max-h-80 object-contain" />
              ) : (
                <img src={selectedRecord.mediaUrl} alt="Preview" className="w-full max-h-80 object-contain" />
              )}
            </div>

            {selectedRecord.mediaUrl && (
              <div className="flex items-center space-x-2 mb-4">
                <a
                  href={selectedRecord.mediaUrl}
                  download={filenameFromMediaUrl(selectedRecord.mediaUrl)}
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Download</span>
                </a>
                <button
                  onClick={() => handleShare(selectedRecord)}
                  disabled={shareStateById[selectedRecord.id] === 'sharing'}
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
                >
                  {shareStateById[selectedRecord.id] === 'shared' || shareStateById[selectedRecord.id] === 'copied' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{shareStateById[selectedRecord.id] === 'copied' ? 'Link Copied' : 'Shared'}</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-3.5 h-3.5 text-fuchsia-400" />
                      <span>{shareStateById[selectedRecord.id] === 'sharing' ? 'Sharing...' : 'Share'}</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Metadata Fields */}
            <div className="space-y-3 text-xs font-mono">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block mb-1 font-sans font-semibold">Prompt:</span>
                <p className="text-slate-200 font-sans text-sm">{selectedRecord.prompt}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block text-[10px] font-sans">Prompt Hash (SHA-256):</span>
                  <span className="text-cyan-300 text-[11px] truncate block">{selectedRecord.promptHash}</span>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block text-[10px] font-sans">AES-256 Encrypted Ciphertext:</span>
                  <span className="text-emerald-400 text-[11px] truncate block">{selectedRecord.encryptedPrompt}</span>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-[10px] font-sans block">Media Storage:</span>
                  <span className="text-slate-300 text-xs flex items-center space-x-1 mt-0.5">
                    <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Vercel Blob (persists even when your PC is off)</span>
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px]">
                  Cloud
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
              >
                Close Inspector
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
