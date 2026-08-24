import React, { useState, useEffect } from 'react';
import {
  X,
  Cloud,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  LogOut,
  LogIn,
  Loader2,
  RefreshCw,
  Shield,
  Info,
  Key,
} from 'lucide-react';
import { getCurrentUserEmail, isGoogleSignedIn } from '../lib/drivePersistence';
import type { AutoSaveState } from '../types';

interface StorageSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoSaveState?: AutoSaveState;
  isSignedIn: boolean;
  isSyncing: boolean;
  onSignIn: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
  onExportSessions: () => void;
  onImportSessions: (file: File, mode?: 'merge' | 'replace') => void;
  onFlushNow: () => Promise<void> | void;
  sessionsCount: number;
}

export const StorageSyncModal: React.FC<StorageSyncModalProps> = ({
  isOpen,
  onClose,
  autoSaveState,
  isSignedIn,
  isSyncing,
  onSignIn,
  onSignOut,
  onExportSessions,
  onImportSessions,
  onFlushNow,
  sessionsCount,
}) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [storageUsageBytes, setStorageUsageBytes] = useState<number>(0);
  const [customClientId, setCustomClientId] = useState<string>(() => {
    return localStorage.getItem('council_custom_google_client_id') || '';
  });
  const [showClientIdInput, setShowClientIdInput] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setUserEmail(getCurrentUserEmail());
      // Calculate local storage approximate size
      try {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            const val = localStorage.getItem(key) || '';
            total += key.length + val.length;
          }
        }
        setStorageUsageBytes(total * 2); // 2 bytes per UTF-16 char
      } catch (e) {
        setStorageUsageBytes(0);
      }
    }
  }, [isOpen, isSignedIn]);

  if (!isOpen) return null;

  const handleSignInClick = async () => {
    setIsSigningIn(true);
    try {
      if (customClientId.trim()) {
        localStorage.setItem('council_custom_google_client_id', customClientId.trim());
      }
      await onSignIn();
      setUserEmail(getCurrentUserEmail());
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleManualSync = async () => {
    setIsFlushing(true);
    try {
      await onFlushNow();
    } finally {
      setTimeout(() => setIsFlushing(false), 500);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportSessions(file, importMode);
      e.target.value = '';
    }
  };

  const storageKb = (storageUsageBytes / 1024).toFixed(1);
  const lastSavedText = autoSaveState?.lastSavedAt
    ? new Date(autoSaveState.lastSavedAt).toLocaleTimeString()
    : 'Active';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Cloud size={20} />
            </div>
            <div>
              <h2 id="storage-modal-title" className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Storage & Cloud Sync</span>
                {isSignedIn && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                    Drive Connected
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Manage where your deliberations, sessions, and persona configurations are saved.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-slate-200 text-xs">
          {/* Storage Status Card */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive size={14} className="text-cyan-400" />
                <span>Active Local Storage Engine</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-500/20">
                <CheckCircle2 size={11} />
                <span>Auto-Saving Enabled</span>
              </span>
            </div>

            <p className="text-slate-400 text-xs leading-relaxed">
              Every council deliberation, synthesis, and attached reference is <strong>automatically persisted</strong> to your browser&apos;s local storage immediately as you type and stream.
            </p>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 font-mono text-center">
              <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/50">
                <div className="text-[10px] text-slate-400 uppercase">Threads</div>
                <div className="text-sm font-bold text-slate-200">{sessionsCount}</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/50">
                <div className="text-[10px] text-slate-400 uppercase">Local Cache</div>
                <div className="text-sm font-bold text-cyan-300">{storageKb} KB</div>
              </div>
              <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/50">
                <div className="text-[10px] text-slate-400 uppercase">Last Sync</div>
                <div className="text-xs font-bold text-slate-300 truncate" title={lastSavedText}>
                  {lastSavedText}
                </div>
              </div>
            </div>
          </div>

          {/* Cloud Sync with Google Drive */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/40 border border-indigo-500/20 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Cloud size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-slate-100">Google Drive Cloud Sync</h3>
                  <p className="text-[11px] text-slate-400">
                    Sync sessions across devices via private Google Drive AppData storage.
                  </p>
                </div>
              </div>
            </div>

            {autoSaveState?.error && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-red-300">
                    <AlertCircle size={14} />
                    <span>Cloud Sync Issue</span>
                  </div>
                  <p className="text-[11px] text-red-200/90 break-words">{autoSaveState.error}</p>
                </div>
                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={isSyncing || isFlushing}
                  className="px-2.5 py-1 rounded-lg bg-red-800 hover:bg-red-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer transition-colors"
                >
                  Retry Sync
                </button>
              </div>
            )}

            {isSignedIn ? (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-emerald-200 truncate">
                        {userEmail || 'Google Account Connected'}
                      </div>
                      <div className="text-[10px] text-emerald-400/80 font-mono">
                        Real-time Drive AppData cloud synchronization active
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleManualSync}
                    disabled={isSyncing || isFlushing}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-600/40 transition-colors cursor-pointer shrink-0"
                  >
                    <RefreshCw size={12} className={isSyncing || isFlushing ? 'animate-spin' : ''} />
                    <span>Sync Now</span>
                  </button>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-emerald-800/40">
                  <button
                    type="button"
                    onClick={handleSignInClick}
                    disabled={isSigningIn}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                    title="Choose a different Google Account"
                  >
                    <LogIn size={12} className="text-cyan-400" />
                    <span>Switch Account</span>
                  </button>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-red-950/40 hover:text-red-300 text-slate-300 border border-slate-700 hover:border-red-800/40 transition-colors cursor-pointer"
                  >
                    <LogOut size={12} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={handleSignInClick}
                    disabled={isSigningIn}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer min-h-[44px]"
                  >
                    {isSigningIn ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        <span>Opening Google Sign-In...</span>
                      </>
                    ) : (
                      <>
                        <LogIn size={15} />
                        <span>Sign In &amp; Choose Google Account</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowClientIdInput(!showClientIdInput)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
                    title="Configure custom Google OAuth Client ID"
                  >
                    <Key size={13} />
                    <span>Config</span>
                  </button>
                </div>

                {showClientIdInput && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <label className="block text-[11px] text-slate-400">
                      Google OAuth Client ID (optional if predefined):
                    </label>
                    <input
                      type="text"
                      value={customClientId}
                      onChange={(e) => setCustomClientId(e.target.value)}
                      placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                      className="w-full bg-slate-900 text-slate-100 text-xs p-2 rounded-lg border border-slate-700 font-mono focus:outline-none focus:border-cyan-500"
                    />
                    <p className="text-[10px] text-slate-400">
                      Requires Google Identity Services (GIS) with Drive AppData scope.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Manual JSON Backup & Restore */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                <Shield size={14} className="text-cyan-400" />
                <span>Offline JSON Backup &amp; Restore</span>
              </h3>
              <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[10px]">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`px-2 py-1 rounded cursor-pointer font-semibold transition-colors ${
                    importMode === 'merge'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Preserves existing deliberations and incorporates uploaded records"
                >
                  Smart Merge (Safe)
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-2 py-1 rounded cursor-pointer font-semibold transition-colors ${
                    importMode === 'replace'
                      ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Overwrites all local records with the uploaded file"
                >
                  Replace All
                </button>
              </div>
            </div>

            <p className="text-slate-400 text-xs">
              {importMode === 'merge'
                ? 'Smart Merge is active: Importing a JSON file will merge sessions with your current history without losing any data.'
                : 'Replace All mode: Importing a JSON file will overwrite your current sessions.'}
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={onExportSessions}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors font-semibold cursor-pointer min-h-[40px]"
              >
                <Download size={14} className="text-cyan-400" />
                <span>Export Sessions JSON</span>
              </button>

              <label className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors font-semibold cursor-pointer min-h-[40px]">
                <Upload size={14} className="text-emerald-400" />
                <span>Import JSON ({importMode === 'merge' ? 'Merge' : 'Replace'})</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileInput}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition-colors cursor-pointer min-h-[38px]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
