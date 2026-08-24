import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionManager } from './hooks/useSessionManager';
import { useModelRecommendations } from './hooks/useModelRecommendations';
import { useTheme } from './hooks/useTheme';
import { fetchCouncilModels } from './lib/openrouter';
import { applyPreset, MODEL_PRESETS, type PresetId } from './lib/presets';
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
  const [activePresetId, setActivePresetId] = useState<PresetId>('balanced_quality');
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
  const [isProCompareEnabled, setIsProCompareEnabled] = useState(false);
  const [autoSelectModels, setAutoSelectModels] = useState(true);
  const [maxRoundCostCeiling, setMaxRoundCostCeiling] = useState(0);
  const [stopAfterStage1, setStopAfterStage1] = useState(false);
  const [useSingleModelForSimple, setUseSingleModelForSimple] = useState(false);
  const [archivistRecentRounds, setArchivistRecentRounds] = useState(2);
  const [proCompareModelId, setProCompareModelId] = useState('anthropic/claude-sonnet-4.5');
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

  const {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
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
  } = useSessionManager();

  // Load the model catalog on mount.
  useEffect(() => {
    fetchCouncilModels()
      .then((models) => setCatalog(models))
      .catch((err) => console.warn('[App] Catalog load notice:', err.message));
  }, []);

  // Create an initial session if none exists.
  const createdRef = useRef(false);
  useEffect(() => {
    if (createdRef.current) return;
    if (sessions.length === 0 && !activeSessionId) {
      createdRef.current = true;
      createSession('New Deliberation', personas, synthesizer, activePresetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, activeSessionId]);

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
    setActivePresetId(presetId);
    const { updatedPersonas, updatedSynthesizer } = applyPreset(presetId, personas, synthesizer, catalog);
    setPersonas(updatedPersonas);
    setSynthesizer(updatedSynthesizer);
  }, [personas, synthesizer, catalog]);

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
              rawModelsCatalog={catalog}
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
              autoSaveState={autoSaveState}
              lastSavedAt={lastSavedAt}
              isSaving={isSaving}
              isSyncing={isSyncing}
              saveDestination={saveDestination}
              onOpenSettings={() => setIsSettingsOpen(true)}
              showToast={showToast}
            />
          ) : view === 'nexus' ? (
            <NexusLabView
              personas={personas}
              synthesizer={synthesizer}
              catalog={catalog}
              onCompleteRound={updateRoundInActiveSession}
              activeSessionId={activeSessionId}
              costCeiling={costCeiling}
            />
          ) : (
            <OracleView
              isSignedIn={isSignedIn}
              catalog={catalog}
              availableModels={catalog.map((m) => ({ id: m.id, name: m.name || m.id }))}
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
        setPersonas={setPersonas}
        synthesizer={synthesizer}
        setSynthesizer={setSynthesizer}
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
        isProCompareEnabled={isProCompareEnabled}
        handleToggleProCompare={() => setIsProCompareEnabled((v) => !v)}
        setIsAuditModalOpen={setIsAuditModalOpen}
        onRefreshModels={hookRecs.refreshModelRecommendations}
        activePresetId={activePresetId}
        setActivePresetId={setActivePresetId}
        onApplyPreset={handleApplyPreset}
        rawModelsCatalog={catalog}
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
        setUseSingleModelForSimple={setUseSingleModelForSimple}
        archivistRecentRounds={archivistRecentRounds}
        setArchivistRecentRounds={setArchivistRecentRounds}
        proCompareModelId={proCompareModelId}
        setProCompareModelId={setProCompareModelId}
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
