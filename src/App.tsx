import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionManager } from './hooks/useSessionManager';
import { useModelRecommendations } from './hooks/useModelRecommendations';
import { useTheme } from './hooks/useTheme';
import { fetchCouncilModels } from './lib/openrouter';
import { applyPreset, MODEL_PRESETS, presetTierFor, type PresetId } from './lib/presets';
import { seatCouncilRoster } from './lib/chamberLabs';
import {
  shouldAutoCreateInitialSession,
  reconcileFreePresetWithModels,
} from './lib/chamberGuards';
import { INITIAL_PERSONAS, defaultSynthesizer } from './data';
import type {
  Persona,
  RawOpenRouterModel,
  CostCeilingConfig,
  NotificationPreferences,
  ToastMessage,
  CouncilRound,
} from './types';
import { CouncilHeader, type AppViewMode } from './components/council/CouncilHeader';
import { CouncilChamber, type CouncilSettings } from './components/CouncilChamber';
import { NexusLabView } from './components/NexusLabView';
import { OracleView } from './components/OracleView';
import { CouncilSidebar } from './components/council/CouncilSidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { StorageSyncModal } from './components/StorageSyncModal';
import { UnifiedToast } from './components/UnifiedToast';
import type { ChamberHandoff } from './lib/chamberHandoff';
import { summarizeTitle } from './lib/titleUtils';
import { hydrateOracleFromIdb } from './lib/oracleStore';

const SETTINGS_KEYS = {
  enableChunking: 'council_enable_chunking',
  showConsensusVisualizer: 'council_show_consensus_viz',
  enableWeightTuning: 'council_enable_weights',
} as const;

function loadBooleanSetting(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  const [view, setView] = useState<AppViewMode>('chamber');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'personas' | 'presets' | 'advanced' | 'oracle_bible' | 'theme' | 'notifications' | 'account'
  >('personas');

  const handleOpenSettingsTab = (
    tab: 'personas' | 'presets' | 'advanced' | 'oracle_bible' | 'theme' | 'notifications' | 'account' = 'personas'
  ) => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };
  const [isStorageSyncOpen, setIsStorageSyncOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [personas, setPersonas] = useState<Persona[]>(INITIAL_PERSONAS);
  const [synthesizer, setSynthesizer] = useState<Persona>(defaultSynthesizer);
  // Default is the working cheap tier — the free tier is opt-in (its models
  // rotate and are verified against the live catalog before use).
  const [activePresetId, setActivePresetId] = useState<PresetId>('highest_quality');
  const [catalog, setCatalog] = useState<RawOpenRouterModel[]>([]);
  const { theme, setTheme } = useTheme();

  // Feature toggles (persisted to localStorage)
  const [enableChunking, setEnableChunkingState] = useState<boolean>(() => loadBooleanSetting(SETTINGS_KEYS.enableChunking));
  const [showConsensusVisualizer, setShowConsensusVisualizerState] = useState<boolean>(() => loadBooleanSetting(SETTINGS_KEYS.showConsensusVisualizer));
  const [enableWeightTuning, setEnableWeightTuningState] = useState<boolean>(() => loadBooleanSetting(SETTINGS_KEYS.enableWeightTuning));

  const setEnableChunking = useCallback((val: boolean) => {
    setEnableChunkingState(val);
    try {
      localStorage.setItem(SETTINGS_KEYS.enableChunking, val ? 'true' : 'false');
    } catch { /* ignore */ }
  }, []);
  const setShowConsensusVisualizer = useCallback((val: boolean) => {
    setShowConsensusVisualizerState(val);
    try {
      localStorage.setItem(SETTINGS_KEYS.showConsensusVisualizer, val ? 'true' : 'false');
    } catch { /* ignore */ }
  }, []);
  const setEnableWeightTuning = useCallback((val: boolean) => {
    setEnableWeightTuningState(val);
    try {
      localStorage.setItem(SETTINGS_KEYS.enableWeightTuning, val ? 'true' : 'false');
    } catch { /* ignore */ }
  }, []);

  // Settings state
  const [maxTokens, setMaxTokens] = useState(4000);
  const [executionMode, setExecutionMode] = useState<'auto' | 'quick_panel' | 'deep_council'>('auto');
  const [webMode, setWebMode] = useState<'off' | 'auto' | 'always'>('auto');
  const [quickPanelMaxTokens, setQuickPanelMaxTokens] = useState(350);
  const [synthesisMaxTokens, setSynthesisMaxTokens] = useState(500);
  const [panelTimeoutSeconds, setPanelTimeoutSeconds] = useState(120);
  const [autoSelectModels, setAutoSelectModels] = useState(true);
  const [maxRoundCostCeiling, setMaxRoundCostCeiling] = useState(0);
  const [stopAfterStage1, setStopAfterStage1] = useState(false);
  const [useSingleModelForSimple, setUseSingleModelForSimple] = useState(false);
  // Confidence Ledger — opt-in Chamber add-on (default off).
  const [outcomeTrackingEnabled, setOutcomeTrackingEnabled] = useState(false);
  const [archivistRecentRounds, setArchivistRecentRounds] = useState(2);
  const [disableFallback, setDisableFallback] = useState(false);
  const [disableLoadingOverlay, setDisableLoadingOverlay] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    enableSoundAlerts: true,
    soundVolume: 0.5,
    enableBrowserNotifications: false,
    notifyOnDeliberationComplete: true,
    notifyOnError: true,
    notifyOnCostThreshold: true,
  });
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  const [costCeiling, setCostCeiling] = useState<CostCeilingConfig>({
    maxSpendPerMissionDollars: 2.0,
    requireApprovalAboveDollars: 0.15,
    strictHardStop: true,
  });

  const hookRecs = useModelRecommendations();

  // One seating source: if hook catalog is at least as complete as the direct fetch, use it.
  // This avoids two competing catalogs where Auto could seat from a thinner list.
  const effectiveCatalog = React.useMemo(() => {
    const hookCat = (hookRecs.rawModelsCatalog || []) as RawOpenRouterModel[];
    if (hookCat.length > 0 && hookCat.length >= catalog.length) return hookCat;
    return catalog;
  }, [catalog, hookRecs.rawModelsCatalog]);

  const {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    patchSession,
    selectSession,
    renameSession,
    deleteSession,
    clearSessionHistory,
    clearAllSessions,
    updateRoundInActiveSession,
    deleteRoundFromActiveSession,
    exportSessionsJSON,
    importSessionsJSON,
    isSignedIn,
    signIn,
    signOut,
    isSyncing,
    isSaving,
    lastSavedAt,
    saveDestination,
    autoSaveState,
    flushNow,
    isLoading,
    driveNeedsReauth,
  } = useSessionManager();

  useEffect(() => {
    void hydrateOracleFromIdb();
  }, []);

  // Load the model catalog on mount.
  useEffect(() => {
    fetchCouncilModels()
      .then((models) => setCatalog(models))
      .catch((err) => console.warn('[App] Catalog load notice:', err.message));
  }, []);

  // Create an initial session if none exists — but only AFTER the session
  // manager has finished loading local/Drive storage. Creating one while the
  // load is in flight produced a blank "New Deliberation" that merged into
  // the synced thread set on every unsigned visit.
  const createdRef = useRef(false);
  useEffect(() => {
    if (createdRef.current) return;
    if (
      shouldAutoCreateInitialSession({
        isLoading,
        sessionCount: sessions.length,
        hasActiveSessionId: Boolean(activeSessionId),
      })
    ) {
      createdRef.current = true;
      createSession('New Deliberation', personas, synthesizer, activePresetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, sessions.length, activeSessionId]);

  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'info', details?: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message, details }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Manual model picks win: a free-tier preset whose roster contains a
  // hand-picked paid model leaves free mode EXPLICITLY (with a toast) instead
  // of erroring mid-deliberation and forcing the owner to re-apply a preset
  // that wipes their choices. The "free never upgrades to paid silently"
  // invariant is untouched: this is a visible preset change, never an
  // in-mode upgrade.
  const presetJustAppliedRef = useRef(0);
  const reconcilePresetWithModels = useCallback(
    (nextPersonas: Persona[], nextSynthesizer: Persona) => {
      const result = reconcileFreePresetWithModels({
        activePresetId,
        personaModels: nextPersonas.filter((p) => p.enabled !== false).map((p) => p.model),
        synthesizerModel: nextSynthesizer?.model,
        catalog: effectiveCatalog,
        presetJustAppliedUntil: presetJustAppliedRef.current,
      });
      if (result.switchToPresetId && result.reason) {
        setActivePresetId(result.switchToPresetId);
        showToast(result.reason, 'warning');
      }
    },
    [activePresetId, effectiveCatalog, showToast]
  );

  const handleSetPersonas = useCallback(
    (next: Persona[]) => {
      setPersonas(next);
      reconcilePresetWithModels(next, synthesizer);
    },
    [reconcilePresetWithModels, synthesizer]
  );

  const handleSetSynthesizer = useCallback(
    (next: Persona) => {
      setSynthesizer(next);
      reconcilePresetWithModels(personas, next);
    },
    [reconcilePresetWithModels, personas]
  );

  // Reconcile once when the live catalog arrives (covers sessions restored
  // with paid picks sitting under a free preset from a previous visit).
  useEffect(() => {
    if (!effectiveCatalog || effectiveCatalog.length === 0) return;
    reconcilePresetWithModels(personas, synthesizer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCatalog.length]);

  const handleSignIn = useCallback(async () => {
    try {
      await signIn();
      showToast('Signed in to Google Drive. Sessions will sync automatically.', 'success');
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    }
  }, [signIn, showToast]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    showToast('Signed out of Google Drive sync.', 'info');
  }, [signOut, showToast]);

  const handleApplyPreset = useCallback((presetId: PresetId) => {
    presetJustAppliedRef.current = Date.now() + 3000;
    setActivePresetId(presetId);
    const { updatedPersonas, updatedSynthesizer } = applyPreset(
      presetId,
      personas,
      synthesizer,
      effectiveCatalog,
      { autoSelect: autoSelectModels }
    );
    setPersonas(updatedPersonas);
    setSynthesizer(updatedSynthesizer);
  }, [personas, synthesizer, effectiveCatalog, autoSelectModels]);

  // $0 preload: Auto on + catalog/roster change reseats unique live labs. No completions.
  // One seating source: effectiveCatalog is hook catalog when it is at least as complete as fetchCouncilModels.
  const lastSeatKeyRef = useRef('');
  useEffect(() => {
    if (!autoSelectModels || !effectiveCatalog || effectiveCatalog.length === 0) return;
    const rosterKey = `${activePresetId}|${effectiveCatalog.map((m) => m.id).join(',')}|${personas.map((p) => p.id).join(',')}|${synthesizer.id}`;
    if (lastSeatKeyRef.current === rosterKey) return;
    lastSeatKeyRef.current = rosterKey;
    const seated = seatCouncilRoster({
      personas,
      synthesizer,
      catalog: effectiveCatalog,
      budget: presetTierFor(activePresetId),
    });
    setPersonas(seated.updatedPersonas);
    setSynthesizer(seated.updatedSynthesizer);
    if (seated.plan.toast) showToast(seated.plan.toast, 'warning');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectModels, effectiveCatalog, activePresetId, personas.map((p) => p.id).join(','), synthesizer.id]);

  const handleExportSessions = useCallback(() => {
    const json = exportSessionsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `council-sessions-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportSessionsJSON]);

  const handleOracleHandoff = useCallback(
    (handoff: ChamberHandoff) => {
      const title = `Case — ${summarizeTitle(handoff.question) || handoff.threadTitle || 'Oracle'}`;
      createSession(title, personas, synthesizer, activePresetId, { handoff });
      setView('chamber');
      showToast('Case brief opened in the Chamber. Review it, then Deliberate. Nothing is written to the Bible yet.', 'info');
    },
    [createSession, personas, synthesizer, activePresetId, showToast]
  );

  const handleImportSessions = useCallback((file: File, mode: 'merge' | 'replace' = 'merge') => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = importSessionsJSON(String(reader.result || ''), mode);
      if (result.success) {
        showToast(result.message, 'success');
      } else {
        showToast(result.message, 'error');
      }
    };
    reader.onerror = () => showToast('Failed to read import file.', 'error');
    reader.readAsText(file);
  }, [importSessionsJSON, showToast]);

  const rounds = activeSession?.rounds || [];
  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(sessionSearchQuery.toLowerCase())
  );

  const settings: CouncilSettings = {
    enableChunking,
    showConsensusVisualizer,
    enableWeightTuning,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <CouncilHeader
        currentView={view}
        onNavigate={(newView) => setView(newView)}
        sessionTitle={activeSession?.title}
        activePresetName={MODEL_PRESETS.find((p) => p.id === activePresetId)?.name || 'Council'}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenStorageSync={() => setIsStorageSyncOpen(true)}
        onToggleMobileDrawer={() => setIsSidebarOpen(true)}
        isSignedIn={isSignedIn}
        isSyncing={isSyncing}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        saveDestination={saveDestination}
        autoSaveState={autoSaveState}
        onSaveNow={flushNow}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

      {driveNeedsReauth && (
        <div className="px-3 sm:px-4 pt-2">
          <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 rounded-xl bg-amber-950/80 border border-amber-600/50 text-amber-100 text-sm">
            <span className="flex-1 min-w-[200px]">
              Drive signed out overnight. Local copy is still saving on this device. Reconnect when you are at the keyboard.
            </span>
            <button
              type="button"
              onClick={() => void handleSignIn()}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer"
            >
              Reconnect Drive
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 w-full">
        {view !== 'oracle' && (
          <CouncilSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          sessions={sessions}
          filteredSessions={filteredSessions}
          activeSessionId={activeSessionId}
          activeSession={activeSession}
          sessionSearchQuery={sessionSearchQuery}
          setSessionSearchQuery={setSessionSearchQuery}
          onCreateNewSession={() => {
            createSession('New Deliberation', personas, synthesizer, activePresetId);
            setIsSidebarOpen(false);
          }}
          onSelectSession={(id) => {
            selectSession(id);
            setIsSidebarOpen(false);
          }}
          onDeleteSession={(id) => deleteSession(id)}
          onRenameSession={(id, title) => renameSession(id, title)}
          onClearAllSessions={clearAllSessions}
          onClearActiveHistory={() => clearSessionHistory()}
          isDeliberating={false}
          isSyncing={isSyncing}
          isSignedIn={isSignedIn}
          onOpenStorageSync={() => setIsStorageSyncOpen(true)}
          onSyncWithCloud={handleSignIn}
          lastSyncedAt={lastSavedAt || activeSession?.updatedAt || null}
        />
        )}

        <main className="flex-1 w-full min-w-0">
          {view === 'chamber' ? (
            <CouncilChamber
              personas={personas}
              synthesizer={synthesizer}
              activePresetId={activePresetId}
              rounds={rounds}
              activeSessionId={activeSessionId}
              activeSession={activeSession}
              sessions={sessions}
              onSelectSession={selectSession}
              onCreateNewSession={() => createSession('New Deliberation', personas, synthesizer, activePresetId)}
              onRenameSession={renameSession}
              onDeleteSession={deleteSession}
              onClearActiveHistory={clearSessionHistory}
              onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
              isSidebarOpen={isSidebarOpen}
              onUpdateRound={updateRoundInActiveSession}
              onCompleteRound={updateRoundInActiveSession}
              onDeleteRound={deleteRoundFromActiveSession}
              flushNow={flushNow}
              rawModelsCatalog={effectiveCatalog}
              settings={settings}
              executionMode={executionMode}
              webMode={webMode}
              autoSelectModels={autoSelectModels}
              maxTokens={maxTokens}
              quickPanelMaxTokens={quickPanelMaxTokens}
              synthesisMaxTokens={synthesisMaxTokens}
              panelTimeoutSeconds={panelTimeoutSeconds}
              stopAfterStage1={stopAfterStage1}
              maxRoundCostCeiling={maxRoundCostCeiling}
              archivistRecentRounds={archivistRecentRounds}
              disableFallback={disableFallback}
              useSingleModelForSimple={useSingleModelForSimple}
              outcomeTrackingEnabled={outcomeTrackingEnabled}
              autoSaveState={autoSaveState}
              lastSavedAt={lastSavedAt}
              isSaving={isSaving}
              isSyncing={isSyncing}
              saveDestination={saveDestination}
              onOpenSettings={() => setIsSettingsOpen(true)}
              showToast={showToast}
              onPatchSession={patchSession}
            />
          ) : view === 'nexus' ? (
            <NexusLabView
              personas={personas}
              synthesizer={synthesizer}
              catalog={effectiveCatalog}
              onCompleteRound={updateRoundInActiveSession}
              activeSessionId={activeSessionId}
              costCeiling={costCeiling}
            />
          ) : (
            <OracleView
              isSignedIn={isSignedIn}
              catalog={effectiveCatalog}
              availableModels={effectiveCatalog.map((m) => ({ id: m.id, name: m.name || m.id }))}
              onOpenSettings={handleOpenSettingsTab}
            />
          )}
        </main>
      </div>

      {/* Settings & Safeguards */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
        personas={personas}
        setPersonas={handleSetPersonas}
        synthesizer={synthesizer}
        setSynthesizer={handleSetSynthesizer}
        theme={theme}
        setTheme={setTheme}
        maxTokens={maxTokens}
        setMaxTokens={setMaxTokens}
        executionMode={executionMode}
        setExecutionMode={setExecutionMode}
        webMode={webMode}
        setWebMode={setWebMode}
        quickPanelMaxTokens={quickPanelMaxTokens}
        setQuickPanelMaxTokens={setQuickPanelMaxTokens}
        synthesisMaxTokens={synthesisMaxTokens}
        setSynthesisMaxTokens={setSynthesisMaxTokens}
        panelTimeoutSeconds={panelTimeoutSeconds}
        setPanelTimeoutSeconds={setPanelTimeoutSeconds}
        setIsAuditModalOpen={setIsAuditModalOpen}
        onRefreshModels={hookRecs.refreshModelRecommendations}
        activePresetId={activePresetId}
        setActivePresetId={setActivePresetId}
        onApplyPreset={handleApplyPreset}
        rawModelsCatalog={effectiveCatalog}
        availableModels={hookRecs.availableModels}
        recommendationMetadata={hookRecs.metadata}
        isRefreshing={hookRecs.isRefreshing}
        isDebounced={hookRecs.isDebounced}
        presetWarnings={hookRecs.presetWarnings}
        autoSelectModels={autoSelectModels}
        setAutoSelectModels={setAutoSelectModels}
        maxRoundCostCeiling={maxRoundCostCeiling}
        setMaxRoundCostCeiling={setMaxRoundCostCeiling}
        stopAfterStage1={stopAfterStage1}
        setStopAfterStage1={setStopAfterStage1}
        useSingleModelForSimple={useSingleModelForSimple}
        outcomeTrackingEnabled={outcomeTrackingEnabled}
        setOutcomeTrackingEnabled={setOutcomeTrackingEnabled}
        setUseSingleModelForSimple={setUseSingleModelForSimple}
        archivistRecentRounds={archivistRecentRounds}
        setArchivistRecentRounds={setArchivistRecentRounds}
        disableFallback={disableFallback}
        setDisableFallback={setDisableFallback}
        disableLoadingOverlay={disableLoadingOverlay}
        setDisableLoadingOverlay={setDisableLoadingOverlay}
        notificationPreferences={notificationPreferences}
        onUpdateNotifications={setNotificationPreferences}
        onExportSessions={handleExportSessions}
        onImportSessions={handleImportSessions}
        sessionsCount={sessions.length}
        isSignedIn={isSignedIn}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        enableChunking={enableChunking}
        setEnableChunking={setEnableChunking}
        showConsensusVisualizer={showConsensusVisualizer}
        setShowConsensusVisualizer={setShowConsensusVisualizer}
        enableWeightTuning={enableWeightTuning}
        setEnableWeightTuning={setEnableWeightTuning}
      />

      {/* Storage & Cloud Sync Center Modal */}
      <StorageSyncModal
        isOpen={isStorageSyncOpen}
        onClose={() => setIsStorageSyncOpen(false)}
        autoSaveState={autoSaveState}
        isSignedIn={isSignedIn}
        isSyncing={isSyncing}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onExportSessions={handleExportSessions}
        onImportSessions={handleImportSessions}
        onFlushNow={flushNow}
        sessionsCount={sessions.length}
      />

      <UnifiedToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
