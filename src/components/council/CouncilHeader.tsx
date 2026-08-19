import React, { useState, useEffect } from 'react';
import { Shield, Settings, Wallet, Menu, Orbit, MessagesSquare, ExternalLink, Sliders } from 'lucide-react';

export type AppViewMode = 'chamber' | 'nexus';

export interface CouncilHeaderProps {
  currentView: AppViewMode;
  onViewChange: (view: AppViewMode) => void;
  sessionTitle?: string;
  activePresetName?: string;
  sessionCost?: number;
  onOpenSettings?: () => void;
  onToggleMobileDrawer?: () => void;
}

export const CouncilHeader: React.FC<CouncilHeaderProps> = ({
  currentView,
  onViewChange,
  sessionTitle,
  activePresetName = 'Deep Council',
  sessionCost,
  onOpenSettings,
  onToggleMobileDrawer,
}) => {
  const [accountBalance, setAccountBalance] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchBalance = async () => {
      try {
        const secret = (import.meta as any).env?.VITE_COUNCIL_ACCESS_KEY || '';
        const res = await fetch('/api/council/account', {
          headers: { 'x-council-key': secret },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data?.data?.limit !== null && data?.data?.usage !== undefined) {
          const remaining = Math.max(0, data.data.limit - data.data.usage);
          setAccountBalance(`$${remaining.toFixed(2)}`);
        }
      } catch {
        if (isMounted) setAccountBalance(null);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 5 * 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const openNexusInNewWindow = () => {
    window.open('?view=nexus', '_blank', 'width=1200,height=900,menubar=no,toolbar=no,location=no');
  };

  return (
    <header className="flex items-center justify-between px-3 sm:px-6 py-2.5 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
      {/* Brand & Mode Switcher */}
      <div className="flex items-center gap-3 sm:gap-5">
        {onToggleMobileDrawer && (
          <button
            onClick={onToggleMobileDrawer}
            className="sm:hidden text-slate-400 hover:text-slate-100 p-1 rounded-md cursor-pointer"
            title="Toggle Sessions Menu"
          >
            <Menu size={18} />
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-tr from-cyan-600 to-blue-500 rounded-xl shadow-sm">
            <Shield size={16} className="text-slate-950" />
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold text-slate-100 tracking-wide flex items-center gap-1.5">
              <span>Remix Council</span>
            </h1>
          </div>
        </div>

        {/* Primary Screen vs Nexus Lab Navigator */}
        <nav className="flex items-center bg-slate-950 rounded-xl p-1 border border-slate-800 text-xs shadow-inner">
          <button
            type="button"
            onClick={() => onViewChange('chamber')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
              currentView === 'chamber'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessagesSquare size={13} />
            <span>Deliberation Chamber</span>
          </button>

          <button
            type="button"
            onClick={() => onViewChange('nexus')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
              currentView === 'nexus'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold shadow-md shadow-emerald-950/40'
                : 'text-emerald-400/90 hover:text-emerald-300'
            }`}
          >
            <Orbit size={13} className="animate-spin-slow" />
            <span>Nexus Lab (Autonomous)</span>
          </button>
        </nav>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Open Nexus Lab in Dedicated Window */}
        <button
          onClick={openNexusInNewWindow}
          className="hidden lg:inline-flex items-center gap-1 text-[11px] font-mono text-emerald-300 hover:text-emerald-100 bg-emerald-950/60 hover:bg-emerald-900/80 px-2.5 py-1 rounded-lg border border-emerald-800 transition-colors cursor-pointer"
          title="Open Nexus Lab in a dedicated separate window"
        >
          <ExternalLink size={11} />
          <span>Pop-out Window</span>
        </button>

        {/* OpenRouter Balance Badge */}
        {accountBalance && (
          <div
            className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-lg border border-cyan-500/30 shadow-sm"
            title="Remaining OpenRouter Balance"
          >
            <Wallet size={12} className="text-cyan-400" />
            <span className="text-cyan-500 font-sans text-[10px]">Bal:</span>
            <strong>{accountBalance}</strong>
          </div>
        )}

        {/* Settings Button */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow-sm cursor-pointer"
            title="Council Settings & Safeguards"
          >
            <Sliders size={13} />
            <span className="hidden sm:inline font-medium">Settings</span>
          </button>
        )}
      </div>
    </header>
  );
};
