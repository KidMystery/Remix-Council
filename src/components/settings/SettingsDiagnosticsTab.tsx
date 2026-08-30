import React, { useState, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Copy,
  Check,
  Download,
  Trash2,
  Search,
  RefreshCw,
  Server,
  Activity,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import {
  useEventLog,
  type DiagnosticEvent,
  type EventLevel,
  type EventScope,
} from '../../lib/eventLog';
import { authenticatedFetch } from '../../lib/apiClient';

export const SettingsDiagnosticsTab: React.FC = () => {
  const {
    events,
    clearEvents,
    exportEventsAsJSON,
    exportEventsAsText,
    recordInfo,
  } = useEventLog();

  const [levelFilter, setLevelFilter] = useState<EventLevel | 'all'>('all');
  const [scopeFilter, setScopeFilter] = useState<EventScope | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [serverEvents, setServerEvents] = useState<any[]>([]);
  const [isFetchingServer, setIsFetchingServer] = useState(false);
  const [showServerLogs, setShowServerLogs] = useState(false);

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (levelFilter !== 'all' && e.level !== levelFilter) return false;
      if (scopeFilter !== 'all' && e.scope.toLowerCase() !== scopeFilter.toLowerCase()) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesTitle = e.title.toLowerCase().includes(q);
        const matchesMsg = e.message.toLowerCase().includes(q);
        const matchesScope = e.scope.toLowerCase().includes(q);
        const matchesModel = e.model ? e.model.toLowerCase().includes(q) : false;
        if (!matchesTitle && !matchesMsg && !matchesScope && !matchesModel) return false;
      }
      return true;
    });
  }, [events, levelFilter, scopeFilter, searchQuery]);

  // Counts
  const counts = useMemo(() => {
    let errors = 0;
    let warns = 0;
    let infos = 0;
    for (const e of events) {
      if (e.level === 'error') errors++;
      else if (e.level === 'warn') warns++;
      else infos++;
    }
    return { total: events.length, errors, warns, infos };
  }, [events]);

  const handleCopyLogs = async () => {
    const text = exportEventsAsText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleExportJSON = () => {
    const json = exportEventsAsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `council-event-log-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFetchServerEvents = async () => {
    setIsFetchingServer(true);
    try {
      const resp = await authenticatedFetch('/api/diagnostics/events?limit=100');
      if (resp.ok) {
        const data = await resp.json();
        setServerEvents(data.events || []);
        setShowServerLogs(true);
        recordInfo('system', 'Server Logs Refreshed', `Retrieved ${(data.events || []).length} server events`);
      }
    } catch (err: any) {
      console.warn('[Diagnostics] Failed to fetch server events:', err);
    } finally {
      setIsFetchingServer(false);
    }
  };

  const getLevelBadge = (level: EventLevel) => {
    switch (level) {
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-950/80 border border-red-800/80 px-2 py-0.5 rounded-full">
            <AlertCircle size={10} />
            <span>ERROR</span>
          </span>
        );
      case 'warn':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/80 border border-amber-800/80 px-2 py-0.5 rounded-full">
            <AlertTriangle size={10} />
            <span>WARN</span>
          </span>
        );
      case 'info':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-400 bg-sky-950/80 border border-sky-800/80 px-2 py-0.5 rounded-full">
            <Info size={10} />
            <span>INFO</span>
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-2 py-0.5 rounded-full">
            <CheckCircle2 size={10} />
            <span>SUCCESS</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 text-slate-200">
      {/* Header Description & Summary Stats */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-100">Event Log & Diagnostics</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyLogs}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
              title="Copy formatted text log to clipboard"
            >
              {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportJSON}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
              title="Download event log as JSON"
            >
              <Download size={11} />
              <span>Export</span>
            </button>
            <button
              type="button"
              onClick={clearEvents}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-red-950/60 hover:text-red-300 text-slate-400 border border-slate-700 hover:border-red-800/50 transition-colors cursor-pointer"
              title="Clear all client-side event records"
            >
              <Trash2 size={11} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Catalog of network requests, Oracle stream events, provider rate limits, model fallbacks,
          and diagnostic traces.
        </p>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-2 pt-1 border-t border-slate-800/80 text-center">
          <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
            <div className="text-[11px] text-slate-400">Total Events</div>
            <div className="text-sm font-bold text-slate-100">{counts.total}</div>
          </div>
          <div className="p-2 rounded-xl bg-red-950/30 border border-red-900/40">
            <div className="text-[11px] text-red-300">Errors</div>
            <div className="text-sm font-bold text-red-400">{counts.errors}</div>
          </div>
          <div className="p-2 rounded-xl bg-amber-950/30 border border-amber-900/40">
            <div className="text-[11px] text-amber-300">Warnings</div>
            <div className="text-sm font-bold text-amber-400">{counts.warns}</div>
          </div>
          <div className="p-2 rounded-xl bg-sky-950/30 border border-sky-900/40">
            <div className="text-[11px] text-sky-300">Info</div>
            <div className="text-sm font-bold text-sky-400">{counts.infos}</div>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by keyword, error text, model, or scope..."
            className="w-full bg-slate-900 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-800 focus:outline-none focus:border-indigo-500 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
          {/* Level Filter */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
              <Filter size={11} /> Level:
            </span>
            {(['all', 'error', 'warn', 'info'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                  levelFilter === lvl
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-400'
                }`}
              >
                {lvl === 'all' ? 'All' : lvl.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Scope Filter */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-400 mr-1">Scope:</span>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as EventScope | 'all')}
              className="bg-slate-900 text-slate-300 text-[11px] px-2 py-1 rounded-lg border border-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">All Scopes</option>
              <option value="oracle">Oracle</option>
              <option value="chamber">Council Chamber</option>
              <option value="nexus">Nexus Lab</option>
              <option value="network">Network / Stream</option>
              <option value="model">Model Provider</option>
              <option value="auth">Auth & Gate</option>
              <option value="storage">Storage & Sync</option>
              <option value="system">System</option>
            </select>
          </div>
        </div>
      </div>

      {/* Server Log Inspector Toggle */}
      <div className="flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={() => {
            if (!showServerLogs && serverEvents.length === 0) {
              handleFetchServerEvents();
            } else {
              setShowServerLogs(!showServerLogs);
            }
          }}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
        >
          <Server size={12} className="text-cyan-400" />
          <span>{showServerLogs ? 'Hide Server-Side Event Log' : 'Inspect Server-Side Event Log'}</span>
        </button>

        {showServerLogs && (
          <button
            type="button"
            onClick={handleFetchServerEvents}
            disabled={isFetchingServer}
            className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={11} className={isFetchingServer ? 'animate-spin' : ''} />
            <span>Refresh Server Log</span>
          </button>
        )}
      </div>

      {/* Server Events View */}
      {showServerLogs && (
        <div className="bg-slate-950 border border-cyan-900/40 rounded-2xl p-3 space-y-2 max-h-56 overflow-y-auto">
          <div className="text-[11px] font-mono text-cyan-400 flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span>Server-Side Ingested Events (GET /api/diagnostics/events)</span>
            <span>{serverEvents.length} events</span>
          </div>
          {serverEvents.length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-4 font-mono">
              {isFetchingServer ? 'Fetching server events...' : 'No server events recorded yet.'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {serverEvents.map((se, i) => (
                <div
                  key={i}
                  className="text-[11px] font-mono p-2 rounded-lg bg-slate-900/90 border border-slate-800/80 space-y-1"
                >
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-slate-500">{new Date(se.ts).toLocaleTimeString()}</span>
                    <span className="uppercase text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                      {se.scope || 'server'}
                    </span>
                  </div>
                  <div className="text-slate-200">{se.message}</div>
                  {se.meta && Object.keys(se.meta).length > 0 && (
                    <pre className="text-[10px] text-slate-500 bg-slate-950 p-1.5 rounded overflow-x-auto">
                      {JSON.stringify(se.meta, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Events Feed */}
      <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
        {filteredEvents.length === 0 ? (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
            <CheckCircle2 size={24} className="text-emerald-400 mx-auto" />
            <p className="text-xs text-slate-300 font-medium">No diagnostic events matching filter</p>
            <p className="text-[11px] text-slate-500">
              {events.length === 0
                ? 'All operations have executed cleanly without recorded errors.'
                : 'Try clearing your search query or level filters to see other events.'}
            </p>
          </div>
        ) : (
          filteredEvents.map((e) => {
            const isExpanded = expandedEventId === e.id;
            return (
              <div
                key={e.id}
                className={`bg-slate-950 border rounded-xl p-3 transition-colors ${
                  e.level === 'error'
                    ? 'border-red-900/60 hover:border-red-800/80'
                    : e.level === 'warn'
                    ? 'border-amber-900/60 hover:border-amber-800/80'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getLevelBadge(e.level)}
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                      {e.scope}
                    </span>
                    {e.model && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-950/70 text-indigo-300 border border-indigo-800/50">
                        {e.model.split('/').pop()}
                      </span>
                    )}
                    {e.status && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800/50">
                        HTTP {e.status}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 shrink-0">
                    {new Date(e.timestampMs).toLocaleTimeString()}
                  </span>
                </div>

                <div className="mt-1.5">
                  <h4 className="text-xs font-semibold text-slate-100">{e.title}</h4>
                  <p className="text-xs text-slate-300 mt-0.5 font-mono leading-relaxed break-words">
                    {e.message}
                  </p>
                </div>

                {e.meta && Object.keys(e.meta).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-900">
                    <button
                      type="button"
                      onClick={() => setExpandedEventId(isExpanded ? null : e.id)}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>{isExpanded ? 'Hide Technical Details' : 'View Technical Details / Stack'}</span>
                    </button>
                    {isExpanded && (
                      <pre className="mt-1.5 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-40">
                        {JSON.stringify(e.meta, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
