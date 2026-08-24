import { X, Cpu, Palette, Bell, User, Zap, BookmarkPlus, BookOpen } from 'lucide-react';
import { useState, useEffect } from 'react';
import { authenticatedFetch } from '../lib/apiClient';
import { Persona, NotificationPreferences } from '../types';
import { applyPreset, PresetId } from '../lib/presets';
import { CouncilPreset } from '../lib/councilPresets';
import { useModelRecommendations } from '../hooks/useModelRecommendations';
import { useOpenRouterCredits } from '../hooks/useOpenRouterCredits';
import { CreatePersonalityModal } from './CreatePersonalityModal';
import { SettingsPersonasTab } from './settings/SettingsPersonasTab';
import { SettingsPresetsTab } from './settings/SettingsPresetsTab';
import { SettingsAdvancedTab } from './settings/SettingsAdvancedTab';
import { SettingsOracleBibleTab } from './settings/SettingsOracleBibleTab';
import { SettingsThemeTab } from './settings/SettingsThemeTab';
import { SettingsAccountTab } from './settings/SettingsAccountTab';
import { SettingsNotificationsTab } from './settings/SettingsNotificationsTab';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'personas' | 'presets' | 'advanced' | 'oracle_bible' | 'theme' | 'notifications' | 'account';
  personas: Persona[];
  setPersonas: (p: Persona[]) => void;
  synthesizer: Persona;
  setSynthesizer: (p: Persona) => void;
  theme: 'dark' | 'light' | 'system';
  setTheme: (t: 'dark' | 'light' | 'system') => void;
  maxTokens?: number;
  setMaxTokens?: (val: number) => void;
  executionMode?: 'auto' | 'quick_panel' | 'deep_council';
  setExecutionMode?: (mode: 'auto' | 'quick_panel' | 'deep_council') => void;
  webMode?: 'off' | 'auto' | 'always';
  setWebMode?: (mode: 'off' | 'auto' | 'always') => void;
  quickPanelMaxTokens?: number;
  setQuickPanelMaxTokens?: (val: number) => void;
  synthesisMaxTokens?: number;
  setSynthesisMaxTokens?: (val: number) => void;
  panelTimeoutSeconds?: number;
  setPanelTimeoutSeconds?: (val: number) => void;
  setIsAuditModalOpen?: (val: boolean) => void;
  onRefreshModels?: (options?: { force?: boolean; applyToPersonas?: boolean }) => Promise<any>;
  activePresetId?: PresetId;
  setActivePresetId?: (id: PresetId) => void;
  onApplyPreset?: (presetId: PresetId) => void;
  rawModelsCatalog?: any[];
  availableModels?: { id: string; name: string }[];
  recommendationMetadata?: any;
  isRefreshing?: boolean;
  isDebounced?: boolean;
  presetWarnings?: string[];
  selectedTaskDomain?: 'auto' | string;
  autoSelectModels?: boolean;
  setAutoSelectModels?: (val: boolean) => void;
  maxRoundCostCeiling?: number;
  setMaxRoundCostCeiling?: (val: number) => void;
  stopAfterStage1?: boolean;
  setStopAfterStage1?: (val: boolean) => void;
  useSingleModelForSimple?: boolean;
  setUseSingleModelForSimple?: (val: boolean) => void;
  outcomeTrackingEnabled?: boolean;
  setOutcomeTrackingEnabled?: (val: boolean) => void;
  archivistRecentRounds?: number;
  setArchivistRecentRounds?: (val: number) => void;
  disableFallback?: boolean;
  setDisableFallback?: (val: boolean) => void;
  disableLoadingOverlay?: boolean;
  setDisableLoadingOverlay?: (val: boolean) => void;
  notificationPreferences?: NotificationPreferences;
  onUpdateNotifications?: (prefs: NotificationPreferences) => void;
  onExportSessions?: () => void;
  onImportSessions?: (file: File) => void;
  sessionsCount?: number;
  isSignedIn?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
  enableChunking?: boolean;
  setEnableChunking?: (val: boolean) => void;
  showConsensusVisualizer?: boolean;
  setShowConsensusVisualizer?: (val: boolean) => void;
  enableWeightTuning?: boolean;
  setEnableWeightTuning?: (val: boolean) => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  initialTab,
  personas,
  setPersonas,
  synthesizer,
  setSynthesizer,
  theme,
  setTheme,
  maxTokens = 4000,
  setMaxTokens,
  executionMode = 'auto',
  setExecutionMode,
  webMode = 'auto',
  setWebMode,
  quickPanelMaxTokens = 350,
  setQuickPanelMaxTokens,
  synthesisMaxTokens = 500,
  setSynthesisMaxTokens,
  panelTimeoutSeconds = 120,
  setPanelTimeoutSeconds,
  setIsAuditModalOpen,
  onRefreshModels,
  activePresetId: propActivePresetId,
  setActivePresetId: propSetActivePresetId,
  onApplyPreset,
  rawModelsCatalog: propRawModelsCatalog,
  availableModels: propAvailableModels,
  recommendationMetadata: propRecommendationMetadata,
  isRefreshing: propIsRefreshing,
  isDebounced: propIsDebounced,
  presetWarnings: propPresetWarnings,
  autoSelectModels = true,
  setAutoSelectModels,
  maxRoundCostCeiling = 0,
  setMaxRoundCostCeiling,
  stopAfterStage1 = false,
  setStopAfterStage1,
  useSingleModelForSimple = false,
  outcomeTrackingEnabled = false,
  setOutcomeTrackingEnabled,
  setUseSingleModelForSimple,
  archivistRecentRounds = 2,
  setArchivistRecentRounds,
  disableFallback = false,
  setDisableFallback,
  disableLoadingOverlay = false,
  setDisableLoadingOverlay,
  notificationPreferences,
  onUpdateNotifications,
  onExportSessions,
  onImportSessions,
  sessionsCount,
  isSignedIn = false,
  onSignIn,
  onSignOut,
  enableChunking = false,
  setEnableChunking,
  showConsensusVisualizer = false,
  setShowConsensusVisualizer,
  enableWeightTuning = false,
  setEnableWeightTuning,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'personas' | 'presets' | 'advanced' | 'oracle_bible' | 'theme' | 'notifications' | 'account'>(
    initialTab || 'personas'
  );
  const [usageData, setUsageData] = useState<{ usage: number; limit: number | null; remaining?: number | null } | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);

  // Sync initialTab if prop changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  const { credits, refresh: refreshCredits } = useOpenRouterCredits();

  useEffect(() => {
    if (credits.limit !== null) {
      setUsageData({ usage: credits.usage, limit: credits.limit, remaining: credits.remaining });
    }
  }, [credits]);

  const hookRecs = useModelRecommendations();

  const metadata = propRecommendationMetadata || hookRecs.metadata;
  const availableModels = propAvailableModels || hookRecs.availableModels;
  const rawModelsCatalog = propRawModelsCatalog || hookRecs.rawModelsCatalog;
  const presetWarnings = propPresetWarnings || hookRecs.presetWarnings;
  const isRefreshing = propIsRefreshing ?? hookRecs.isRefreshing;
  const isDebounced = propIsDebounced ?? hookRecs.isDebounced;
  const refreshModelRecommendations = hookRecs.refreshModelRecommendations;

  const [localActivePresetId, setLocalActivePresetId] = useState<PresetId>('balanced_quality');
  const activePresetId = propActivePresetId || localActivePresetId;
  const setActivePresetId = propSetActivePresetId || setLocalActivePresetId;

  const handleSavePersona = (savedPersona: Persona) => {
    const exists = personas.some((p) => p.id === savedPersona.id);
    if (exists) {
      setPersonas(personas.map((p) => (p.id === savedPersona.id ? savedPersona : p)));
    } else {
      setPersonas([...personas, savedPersona]);
    }
  };

  const handleApplyCouncilPreset = (preset: CouncilPreset) => {
    setPersonas(preset.personas);
    setSynthesizer(preset.synthesizer);
  };

  const handleApplyPreset = (presetId: PresetId) => {
    setActivePresetId(presetId);
    if (onApplyPreset) {
      onApplyPreset(presetId);
    } else {
      const { updatedPersonas, updatedSynthesizer } = applyPreset(presetId, personas, synthesizer, rawModelsCatalog);
      setPersonas(updatedPersonas);
      setSynthesizer(updatedSynthesizer);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'account') {
      authenticatedFetch('/api/council/account')
        .then((r) => r.json())
        .then((d) => {
          if (d.data) {
            setUsageData({ usage: d.data.usage, limit: d.data.limit });
          }
        })
        .catch((e) => console.error('Failed to fetch usage:', e));
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const tabs = [
    { id: 'personas', label: 'Basic Details', icon: Cpu },
    { id: 'presets', label: 'Presets', icon: BookmarkPlus },
    { id: 'advanced', label: 'Advanced', icon: Zap },
    { id: 'oracle_bible', label: 'Oracle Memory', icon: BookOpen },
    { id: 'theme', label: 'Theme', icon: Palette },
    { id: 'notifications', label: 'Alerts', icon: Bell },
    { id: 'account', label: 'Account', icon: User },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20 dark:bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex px-4 pt-2 space-x-6 border-b border-slate-100 dark:border-slate-800 overflow-x-auto custom-scrollbar shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'personas' && (
            <SettingsPersonasTab
              personas={personas}
              setPersonas={setPersonas}
              synthesizer={synthesizer}
              setSynthesizer={setSynthesizer}
              availableModels={availableModels}
              rawModelsCatalog={rawModelsCatalog}
              metadata={metadata}
              presetWarnings={presetWarnings}
              autoSelectModels={autoSelectModels}
              setAutoSelectModels={setAutoSelectModels}
              onRefreshModels={onRefreshModels}
              refreshModelRecommendations={refreshModelRecommendations}
              isRefreshing={isRefreshing}
              isDebounced={isDebounced}
              onApplyPreset={handleApplyPreset}
              onApplyCouncilPreset={handleApplyCouncilPreset}
              onOpenCreateModal={(p) => {
                setEditingPersona(p || null);
                setIsCreateModalOpen(true);
              }}
              enableWeightTuning={enableWeightTuning}
              setEnableWeightTuning={setEnableWeightTuning}
            />
          )}

          {activeTab === 'presets' && (
            <SettingsPresetsTab
              personas={personas}
              synthesizer={synthesizer}
              activePresetId={activePresetId}
              onApplyPreset={handleApplyPreset}
              onApplyCouncilPreset={handleApplyCouncilPreset}
              rawModelsCatalog={rawModelsCatalog}
            />
          )}

          {activeTab === 'advanced' && (
            <SettingsAdvancedTab
              personas={personas}
              setPersonas={setPersonas}
              synthesizer={synthesizer}
              setSynthesizer={setSynthesizer}
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
              maxRoundCostCeiling={maxRoundCostCeiling}
              setMaxRoundCostCeiling={setMaxRoundCostCeiling}
              stopAfterStage1={stopAfterStage1}
              setStopAfterStage1={setStopAfterStage1}
              useSingleModelForSimple={useSingleModelForSimple}
              setUseSingleModelForSimple={setUseSingleModelForSimple}
              outcomeTrackingEnabled={outcomeTrackingEnabled}
              setOutcomeTrackingEnabled={setOutcomeTrackingEnabled}
              archivistRecentRounds={archivistRecentRounds}
              setArchivistRecentRounds={setArchivistRecentRounds}
              disableFallback={disableFallback}
              setDisableFallback={setDisableFallback}
              disableLoadingOverlay={disableLoadingOverlay}
              setDisableLoadingOverlay={setDisableLoadingOverlay}
              availableModels={propAvailableModels}
              onExportSessions={onExportSessions}
              onImportSessions={onImportSessions}
              sessionsCount={sessionsCount}
              enableChunking={enableChunking}
              setEnableChunking={setEnableChunking}
              showConsensusVisualizer={showConsensusVisualizer}
              setShowConsensusVisualizer={setShowConsensusVisualizer}
              enableWeightTuning={enableWeightTuning}
              setEnableWeightTuning={setEnableWeightTuning}
            />
          )}

          {activeTab === 'oracle_bible' && (
            <SettingsOracleBibleTab catalog={rawModelsCatalog} />
          )}

          {activeTab === 'theme' && (
            <SettingsThemeTab
              theme={theme}
              setTheme={setTheme}
            />
          )}

          {activeTab === 'notifications' && (
            <SettingsNotificationsTab
              notificationPreferences={notificationPreferences}
              onUpdateNotifications={onUpdateNotifications}
            />
          )}

          {activeTab === 'account' && (
            <SettingsAccountTab
              usageData={usageData}
              onRefresh={refreshCredits}
              isSignedIn={isSignedIn}
              onSignIn={onSignIn}
              onSignOut={onSignOut}
            />
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            Save Settings
          </button>
        </div>
      </div>

      <CreatePersonalityModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingPersona(null);
        }}
        onSave={handleSavePersona}
        availableModels={availableModels}
        editingPersona={editingPersona}
      />
    </div>
  );
}
