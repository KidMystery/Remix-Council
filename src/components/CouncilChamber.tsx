import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Persona, CouncilRound, Settings, PersonaResponse, NotificationPreferences, RoundRating, ToastMessage, ToastType, CapabilityFailure } from '../types';
import { INITIAL_PERSONAS, CHAIRMAN_PROMPT, defaultSynthesizer, PRO_MODEL_SYSTEM_PROMPT } from '../data';
import { playNotificationChime, sendDesktopNotification } from '../lib/notifications';
import { MessageMarkdown } from './MessageMarkdown';
import { SettingsPanel } from './SettingsPanel';
import { useSessionManager } from '../hooks/useSessionManager';
import { useCouncilReducer } from '../hooks/useCouncilReducer';
import { usePersonaStream } from '../hooks/usePersonaStream';
import { useModelRecommendations } from '../hooks/useModelRecommendations';
import { detectCodeCapabilityRefusal, upgradeToHighCapabilityCodingCouncil } from '../lib/capabilityGuard';
import {
  countTotalSessionTokens,
  countTotalSessionCost,
  countRoundCost,
  estimateTokens,
  estimateCost,
  formatCost,
  calculateCallCost,
  buildArchivistContext,
} from '../lib/archivist';
import { applyPreset, checkDuplicateModels, PresetId, cleanModelName } from '../lib/presets';
import { detectTaskDomain, applySmartModelSelection, TaskDomain, DOMAIN_MODEL_MAPPINGS, SmartSelectionResult } from '../lib/smartModelSelector';
import { SmartSelectionAuditCard } from './SmartSelectionAuditCard';
import { useSpeech } from '../hooks/useSpeech';
import { extractTextFromPDF } from '../lib/pdfUtils';
import { extractCodeFromZip, ZipArchiveResult } from '../lib/zipReader';
import { ZipFilesModal } from './ZipFilesModal';
import { ExecutionMode, ResolvedExecutionMode, classifyQueryMode, resolveExecutionMode } from '../lib/modeClassifier';
import { FallbackAuditModal } from './FallbackAuditModal';
import { CouncilSummaryBar } from './CouncilSummaryBar';
import { ModelDetailsCard } from './ModelDetailsCard';
import { AuditLogModal } from './AuditLogModal';
import { CompareProCard } from './CompareProCard';
import {
  getStoredAuditLogs,
  saveAuditLog,
  getProCompareSetting,
  setProCompareSetting,
  calculateScoresForModel,
  CouncilRequestAuditLog,
  ModelRequestAudit,
} from '../lib/auditLogger';
import { getAuthorOrganization } from '../lib/modelMapper';
import { streamOpenRouterCompletion } from '../lib/openrouter';
import { policyForPreset } from '../lib/executionPolicy';
import { LATEST_GEMINI_FLASH } from '../config/modelCatalog';
import {
  streamPersonaWithFallback,
  getStoredFallbackEvents,
  FallbackEvent,
  computeOrderedBackupList,
} from '../lib/fallbackManager';
import {
  loginWithGoogle,
  logout,
  onAuthChange,
  syncUserSettings,
  loadUserSettings,
  handleAuthRedirectResult,
} from '../lib/persistence';
import { User } from 'firebase/auth';
import { WebMode } from '../shared/webGrounding';
import { useTheme } from '../hooks/useTheme';
import { useFileAttachment, AttachedFile } from '../hooks/useFileAttachment';
import { CouncilSidebar } from './council/CouncilSidebar';
import { CouncilHeader } from './council/CouncilHeader';
import { GroundingSourcesCard } from './GroundingSourcesCard';
import { HeaderActions } from './HeaderActions';
import { Composer } from './Composer';
import { CouncilRoundView } from './CouncilRoundView';
import { SynthesisCard } from './SynthesisCard';
import { UnifiedToast } from './UnifiedToast';
import {
  Settings as SettingsIcon,
  Globe,
  Play,
  Square,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Plus,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  Sparkles,
  Cpu,
  Brain,
  Volume2,
  VolumeX,
  Paperclip,
  Archive,
  X,
  DollarSign,
  PanelLeft,
  PanelLeftClose,
  Search,
  Clock,
  Loader2, Send,
  Edit3,
  Zap,
  Activity,
  Award,
  AlertTriangle,
  Coins,
  Scale,
  Layers,
  Shuffle,
  ShieldAlert,
  Eye,
  EyeOff,
  Sliders,
  Code,
  Calculator,
  Palette,
  Compass,
} from 'lucide-react';

interface ThinkingIndicatorProps {
  stageLabel: string;
  personaName: string;
  role?: string;
  model?: string;
  accentColor?: 'cyan' | 'purple' | 'amber';
}

const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  stageLabel,
  personaName,
  role,
  model,
  accentColor = 'cyan',
}) => {
  const colorMap = {
    cyan: {
      border: 'border-cyan-500/40',
      text: 'text-cyan-400',
      dot: 'bg-cyan-400',
    },
    purple: {
      border: 'border-purple-500/40',
      text: 'text-purple-400',
      dot: 'bg-purple-400',
    },
    amber: {
      border: 'border-amber-500/40',
      text: 'text-amber-400',
      dot: 'bg-amber-400',
    },
  }[accentColor];

  return (
    <div className={`p-4 rounded-xl bg-white dark:bg-slate-900/80 border ${colorMap.border} space-y-3 animate-pulse shadow-sm`}>
      <div className="flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center space-x-2">
          <Loader2 size={13} className={`animate-spin ${colorMap.text}`} />
          <span className={`font-semibold ${colorMap.text}`}>{stageLabel}</span>
        </div>
        {model && (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono truncate max-w-[140px]" title={model}>
            {model}
          </span>
        )}
      </div>
      <div className="flex items-center space-x-2 text-xs text-slate-600 italic">
        <span className="flex space-x-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${colorMap.dot} animate-bounce`} style={{ animationDuration: '0.8s' }} />
          <span className={`w-2 h-2 rounded-full ${colorMap.dot} animate-bounce`} style={{ animationDuration: '0.8s', animationDelay: '150ms' }} />
          <span className={`w-2 h-2 rounded-full ${colorMap.dot} animate-bounce`} style={{ animationDuration: '0.8s', animationDelay: '300ms' }} />
        </span>
        <span className="truncate" title={`${personaName} ${role ? `(${role})` : ''} is formulating analysis...`}>
          {personaName} {role ? `(${role})` : ''} is formulating analysis...
        </span>
      </div>
    </div>
  );
};

interface Props {
  settings?: Settings;
  onUpdateSettings?: (settings: Settings) => void;
}

export const CouncilChamber: React.FC<Props> = ({ settings: propsSettings, onUpdateSettings }) => {
  const [internalSettings, setInternalSettings] = useState<Settings>(() => {
    try {
      const savedKey =
        localStorage.getItem('openrouter_api_key') ||
        
        '';
      const savedModels = localStorage.getItem('council_default_models');
      const savedMaxTokens = localStorage.getItem('council_max_tokens');
      const savedMode = localStorage.getItem('council_execution_mode') as ExecutionMode;
      const savedQuickTokens = localStorage.getItem('council_quick_tokens');
      const savedSynthTokens = localStorage.getItem('council_synth_tokens');
      const savedTimeout = localStorage.getItem('council_panel_timeout');
      const savedCostCeiling = localStorage.getItem('council_cost_ceiling');
      const savedStopStage1 = localStorage.getItem('council_stop_after_stage1');
      const savedSingleModelSimple = localStorage.getItem('council_single_model_simple');
      const savedArchivistRecentRounds = localStorage.getItem('council_archivist_recent_rounds');
      const savedProCompareModelId = localStorage.getItem('council_pro_compare_model_id');

      const savedDisableFallback = localStorage.getItem('council_disable_fallback');
      const savedDisableLoadingOverlay = localStorage.getItem('council_disable_loading_overlay');

      const defaultModels = savedModels
        ? JSON.parse(savedModels)
        : {
            skeptic: 'deepseek/deepseek-chat',
            visionary: 'anthropic/claude-3.5-haiku',
            pragmatist: 'openai/gpt-4o-mini',
            synthesizer: 'google/gemini-3.7-flash',
          };
      return {
        apiKey: '',
        defaultModels,
        temperature: 0.7,
        maxTokens: savedMaxTokens ? parseInt(savedMaxTokens, 10) : 4000,
        executionMode: savedMode || 'auto',
        quickPanelMaxTokens: savedQuickTokens ? parseInt(savedQuickTokens, 10) : 350,
        synthesisMaxTokens: savedSynthTokens ? parseInt(savedSynthTokens, 10) : 500,
        panelTimeoutSeconds: savedTimeout ? parseInt(savedTimeout, 10) : 30,
        maxRoundCostCeiling: savedCostCeiling ? parseFloat(savedCostCeiling) : 0,
        stopAfterStage1: savedStopStage1 === 'true',
        useSingleModelForSimple: savedSingleModelSimple === 'true',
        archivistRecentRounds: savedArchivistRecentRounds ? parseInt(savedArchivistRecentRounds, 10) : 2,
        proCompareModelId: savedProCompareModelId || 'anthropic/claude-3.7-sonnet',
        disableFallback: savedDisableFallback === 'true',
        disableLoadingOverlay: savedDisableLoadingOverlay === 'true',
        webMode: (localStorage.getItem('council_web_mode') as WebMode) || 'auto',
      };
    } catch {
      return {
        apiKey: '',
        defaultModels: {
          skeptic: 'deepseek/deepseek-chat',
          visionary: 'anthropic/claude-3.5-haiku',
          pragmatist: 'openai/gpt-4o-mini',
          synthesizer: 'google/gemini-3.7-flash',
        },
        temperature: 0.7,
        maxTokens: 4000,
        executionMode: 'auto',
        quickPanelMaxTokens: 350,
        synthesisMaxTokens: 500,
        panelTimeoutSeconds: 30,
        maxRoundCostCeiling: 0,
        stopAfterStage1: false,
        useSingleModelForSimple: false,
        archivistRecentRounds: 2,
        proCompareModelId: 'anthropic/claude-3.7-sonnet',
        disableFallback: false,
        disableLoadingOverlay: false,
        webMode: 'auto',
      };
    }
  });

  const settings = propsSettings || internalSettings;

  // Firebase Auth State
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;

    handleAuthRedirectResult().then((u) => {
      if (!cancelled && u) {
        setUser(u);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      if (u) {
        showToast(`Signed in as ${u.displayName || u.email}`);
        // Load cloud preferences if available
        loadUserSettings(u.uid).then((cloudData) => {
          if (cloudData) {
            if (cloudData.settings) {
              setInternalSettings((prev) => ({ ...prev, ...cloudData.settings }));
            }
            if (cloudData.personas && cloudData.personas.length > 0) {
              setPersonas(cloudData.personas);
            }
            if (cloudData.synthesizer) {
              setSynthesizer(cloudData.synthesizer);
            }
          }
        }).catch(err => console.warn('Could not fetch cloud settings:', err));
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      const result = await loginWithGoogle();

      if (result === 'redirecting') {
        showToast('Google sign-in will continue after redirect...');
        return;
      }

      if (result) {
        setUser(result);
        showToast(`Signed in as ${result.displayName || result.email}`);
        return;
      }
    } catch (err: any) {
      showToast(`Google sign-in failed: ${err?.message || String(err)}`, 'error', 6500);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setUser(null);
    showToast('Signed out of cloud sync');
  };

  const {
    sessions,
    activeSessionId,
    activeSession,
    createNewSession,
    selectSession,
    deleteSession,
    clearSessionHistory,
    clearAllSessions,
    addRoundToActiveSession,
    updateRoundInActiveSession,
    updateActiveSessionConfig,
    updateActiveSessionFiles,
    deleteRoundFromActiveSession,
    exportSessionsJSON,
    importSessionsJSON,
  } = useSessionManager(user);

  // Council Reducer for decoupled state updates
  const { rounds, dispatch, setRounds } = useCouncilReducer(activeSession?.rounds || []);

  // Sync reducer rounds when active session changes or when rounds in active session are modified
  useEffect(() => {
    const newRounds = activeSession?.rounds || [];
    setRounds(newRounds);
    
    // Auto-collapse all but the last round when loading a session
    if (newRounds.length > 0) {
      setCollapsedRoundIds(new Set(newRounds.slice(0, -1).map(r => r.id)));
    } else {
      setCollapsedRoundIds(new Set());
    }

    // Restore per-session council configuration if available
    if (activeSession) {
      if (activeSession.presetId) {
        setActivePresetId(activeSession.presetId);
      }
      if (activeSession.personas && activeSession.personas.length > 0) {
        setPersonas(activeSession.personas);
      }
      if (activeSession.synthesizer) {
        setSynthesizer(activeSession.synthesizer);
      }
    }
  }, [activeSessionId, activeSession?.rounds?.length, setRounds]);

  // Persona Stream Custom Hook
  const { streamPersona } = usePersonaStream();
  const { speak, stop: stopSpeech, speakingId } = useSpeech();
  
  // Model Recommendations App-Load & 15-min background check hook
  const { 
    metadata: recommendationMetadata, 
    rawModelsCatalog, 
    availableModels,
    isRefreshing,
    isDebounced,
    refreshModelRecommendations,
    presetWarnings
  } = useModelRecommendations();
  const [activePresetId, setActivePresetId] = useState<PresetId>('fast_and_free');

  const [query, setQuery] = useState('');
  const [isDeliberating, setIsDeliberating] = useState(false);
  const deliberationLockRef = useRef(false);

  const acquireDeliberationLock = () => {
    if (deliberationLockRef.current) return false;
    deliberationLockRef.current = true;
    setIsDeliberating(true);
    return true;
  };

  const releaseDeliberationLock = () => {
    deliberationLockRef.current = false;
    setIsDeliberating(false);
  };
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [basicMode, setBasicMode] = useState(() => {
    const saved = localStorage.getItem('council_basic_mode');
    if (saved !== null) {
      return saved === 'true';
    }
    return typeof window !== 'undefined' && window.innerWidth < 768;
  });

  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        if (localStorage.getItem('council_basic_mode') === null) {
          setBasicMode(true);
        }
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleBasicMode = () => {
    const next = !basicMode;
    setBasicMode(next);
    localStorage.setItem('council_basic_mode', next.toString());
  };

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [fallbackLogs, setFallbackLogs] = useState<FallbackEvent[]>(() => getStoredFallbackEvents());
  const [isFallbackModalOpen, setIsFallbackModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isProCompareEnabled, setIsProCompareEnabled] = useState<boolean>(() => getProCompareSetting());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((
    msgOrToast: any,
    typeOrDuration?: ToastType | number,
    maybeDuration?: number
  ) => {
    // If called directly as an event handler (e.g. onClick={showToast}), ignore synthetic events
    if (msgOrToast && typeof msgOrToast === 'object' && ('nativeEvent' in msgOrToast || '_reactName' in msgOrToast || 'bubbles' in msgOrToast)) {
      return '';
    }
    if (!msgOrToast) return '';

    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let finalType: ToastType = 'info';
    let finalDuration = 4500;

    if (typeof typeOrDuration === 'number') {
      finalDuration = typeOrDuration;
    } else if (typeof typeOrDuration === 'string') {
      finalType = typeOrDuration as ToastType;
      if (typeof maybeDuration === 'number') {
        finalDuration = maybeDuration;
      }
    }

    let newToast: ToastMessage;
    if (typeof msgOrToast === 'string') {
      newToast = { id, message: msgOrToast, type: finalType, duration: finalDuration };
    } else if (typeof msgOrToast === 'object') {
      let rawMessage = msgOrToast.message;
      if (typeof rawMessage !== 'string') {
        rawMessage = rawMessage ? (rawMessage.message || JSON.stringify(rawMessage)) : String(msgOrToast);
      }
      let rawDetails = msgOrToast.details;
      if (rawDetails && typeof rawDetails !== 'string') {
        rawDetails = typeof rawDetails === 'object' ? JSON.stringify(rawDetails, null, 2) : String(rawDetails);
      }
      newToast = {
        id,
        message: rawMessage || 'Notification',
        title: typeof msgOrToast.title === 'string' ? msgOrToast.title : undefined,
        type: msgOrToast.type || finalType,
        duration: msgOrToast.duration ?? finalDuration,
        details: rawDetails,
        action: msgOrToast.action,
      };
    } else {
      newToast = { id, message: String(msgOrToast), type: finalType, duration: finalDuration };
    }

    setToasts((prev) => [...prev.slice(-4), newToast]);

    if (newToast.duration && newToast.duration > 0) {
      window.setTimeout(() => {
        dismissToast(id);
      }, newToast.duration);
    }
    return id;
  }, [dismissToast]);

  const handleToggleProCompare = () => {
    const nextVal = !isProCompareEnabled;
    setIsProCompareEnabled(nextVal);
    setProCompareSetting(nextVal);
    showToast(nextVal ? '⚡ Blind Pro Compare (Phase 2) Enabled' : '⏸️ Blind Pro Compare Disabled');
  };

  const rotateRoleAssignments = () => {
    const activePersonas = personas.filter((p) => p.enabled !== false);
    if (activePersonas.length < 2) return;

    const models = activePersonas.map((p) => p.model || settings.defaultModels[p.id] || '');
    const shiftedModels = [...models.slice(1), models[0]];

    let activeIdx = 0;
    const newPersonas = personas.map((p) => {
      if (p.enabled !== false) {
        const newModel = shiftedModels[activeIdx++];
        return { ...p, model: newModel };
      }
      return p;
    });

    setPersonas(newPersonas);
    const newDefaultModels = { ...settings.defaultModels };
    newPersonas.forEach((p) => {
      newDefaultModels[p.id] = p.model;
    });
    const updatedSettings = { ...settings, defaultModels: newDefaultModels };
    setInternalSettings(updatedSettings);
    if (onUpdateSettings) onUpdateSettings(updatedSettings);

    showToast('🔄 Role model assignments rotated across active council members', 3500);
  };

  ;

  const updateExecutionMode = (mode: ExecutionMode) => {
    localStorage.setItem('council_execution_mode', mode);
    const updated = { ...settings, executionMode: mode };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateQuickPanelMaxTokens = (val: number) => {
    localStorage.setItem('council_quick_tokens', val.toString());
    const updated = { ...settings, quickPanelMaxTokens: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateSynthesisMaxTokens = (val: number) => {
    localStorage.setItem('council_synth_tokens', val.toString());
    const updated = { ...settings, synthesisMaxTokens: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updatePanelTimeoutSeconds = (val: number) => {
    localStorage.setItem('council_panel_timeout', val.toString());
    const updated = { ...settings, panelTimeoutSeconds: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateEnableSearchGrounding = (enabled: boolean) => {
    localStorage.setItem('council_search_grounding', enabled.toString());
    const updated = { ...settings, enableSearchGrounding: enabled };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateMaxRoundCostCeiling = (val: number) => {
    localStorage.setItem('council_cost_ceiling', val.toString());
    const updated = { ...settings, maxRoundCostCeiling: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateStopAfterStage1 = (val: boolean) => {
    localStorage.setItem('council_stop_after_stage1', val.toString());
    const updated = { ...settings, stopAfterStage1: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateUseSingleModelForSimple = (val: boolean) => {
    localStorage.setItem('council_single_model_simple', val.toString());
    const updated = { ...settings, useSingleModelForSimple: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateArchivistRecentRounds = (val: number) => {
    localStorage.setItem('council_archivist_recent_rounds', val.toString());
    const updated = { ...settings, archivistRecentRounds: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateProCompareModelId = (val: string) => {
    localStorage.setItem('council_pro_compare_model_id', val);
    const updated = { ...settings, proCompareModelId: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const updateDisableFallback = (val: boolean) => {
    localStorage.setItem('council_disable_fallback', val.toString());
    const updated = { ...settings, disableFallback: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
    showToast(val ? '🛡️ Strict No-Fallback Mode active (errors will be shown directly)' : '🔄 Model Fallbacks enabled', 2500);
  };

  const updateDisableLoadingOverlay = (val: boolean) => {
    localStorage.setItem('council_disable_loading_overlay', val.toString());
    const updated = { ...settings, disableLoadingOverlay: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
    showToast(val ? '🚫 Deliberation overlay hidden (live feed view)' : '📺 Deliberation overlay enabled', 2500);
  };

  const updateWebMode = (val: WebMode) => {
    localStorage.setItem('council_web_mode', val);
    const updated = { ...settings, webMode: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
    showToast(`🌐 Web Grounding set to ${val.toUpperCase()}`, 2500);
  };

  const [isIsolatedRound, setIsIsolatedRound] = useState(false);

  const updateNotificationPreferences = (prefs: NotificationPreferences) => {
    localStorage.setItem('council_notification_preferences', JSON.stringify(prefs));
    const updated = { ...settings, notificationPreferences: prefs };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
  };

  const handleRateRound = (roundId: string, rating: RoundRating) => {
    dispatch({
      type: 'SET_ROUND_RATING',
      payload: { roundId, rating },
    });
    const targetRound = rounds.find((r) => r.id === roundId);
    if (targetRound) {
      updateRoundInActiveSession(roundId, (r) => ({
        ...r,
        rating,
      }));
    }
    showToast(`⭐ Saved feedback: ${rating.score} / 5 stars`);
  };

  const handleImportSessionsFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        const result = importSessionsJSON(text);
        if (result.success) {
          showToast(`Imported ${result.count} session(s) successfully!`);
        } else {
          showToast(`Import failed: ${result.error}`, 4000);
        }
      }
    };
    reader.readAsText(file);
  };

  const filteredSessions = sessions.filter((s) => {
    if (!sessionSearchQuery.trim()) return true;
    const q = sessionSearchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.rounds.some((r) => {
        if (r.userQuery.toLowerCase().includes(q)) return true;
        if (r.synthesis?.content?.toLowerCase().includes(q)) return true;
        if (Object.values(r.deliberation?.stage1 || {}).some((p: any) => p.content?.toLowerCase().includes(q))) return true;
        if (Object.values(r.deliberation?.stage2 || {}).some((p: any) => p.content?.toLowerCase().includes(q))) return true;
        return false;
      })
    );
  });


  const handleDeleteRound = (roundId: string) => {
    dispatch({ type: 'DELETE_ROUND', payload: { roundId } });
    deleteRoundFromActiveSession(roundId);
  };

  const handleClearActiveHistory = () => {
    dispatch({ type: 'SET_ROUNDS', payload: [] });
    clearSessionHistory(activeSessionId || undefined);
    showToast('🗑️ Chat history cleared for this thread', 3000);
  };

  const handleEditPrompt = (roundId: string) => {
    const round = rounds.find((r) => r.id === roundId);
    if (round) {
      setQuery(round.userQuery);
      setAttachedFiles([]); // Reset any currently attached files as they'd be included in the userQuery text if there were any, or we can just start fresh
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  // File Upload State Hook
  const {
    attachedFiles,
    setAttachedFiles,
    fileError,
    setFileError,
    activeZipResult,
    setActiveZipResult,
    isZipModalOpen,
    setIsZipModalOpen,
    fileInputRef,
    processFiles,
    handleFileUpload,
    handlePaste,
    handleDrop,
    handleDragOver,
    removeAttachedFile,
    clearAttachedFiles,
  } = useFileAttachment({ showToast });

  // Sync attached files with the active thread / session
  useEffect(() => {
    if (activeSession?.attachedFiles && activeSession.attachedFiles.length > 0) {
      setAttachedFiles(
        activeSession.attachedFiles.map((f) => ({
          name: f.name,
          type: f.type || 'text/plain',
          size: f.size,
          content: f.content,
        }))
      );
    } else {
      setAttachedFiles([]);
    }
  }, [activeSessionId]);

  const handleRemoveAttachedFile = useCallback((idx: number) => {
    removeAttachedFile(idx);
    const updated = attachedFiles.filter((_, i) => i !== idx);
    updateActiveSessionFiles(
      updated.map((f) => ({
        name: f.name,
        type: f.type || 'text/plain',
        size: f.size,
        content: f.content,
        summary: f.unzippedResult
          ? `${f.unzippedResult.extractedCodeFilesCount} code files extracted (${Math.round(f.size / 1024)} KB)`
          : `${Math.round(f.content.length / 1000)}k chars (${Math.round(f.size / 1024)} KB)`,
      }))
    );
  }, [attachedFiles, removeAttachedFile, updateActiveSessionFiles]);

  const handleProcessAndSyncFiles = useCallback(async (files: FileList | File[]) => {
    await processFiles(files);
  }, [processFiles]);

  // Theme Preference State Hook
  const { theme, setTheme } = useTheme();

  const [personas, setPersonas] = useState<Persona[]>(() => {
    return INITIAL_PERSONAS.map(p => ({
      ...p,
      model: settings.defaultModels[p.id] || p.model
    }));
  });
  const [synthesizer, setSynthesizer] = useState<Persona>(() => {
    return {
      ...defaultSynthesizer,
      model: settings.defaultModels['synthesizer'] || defaultSynthesizer.model
    };
  });

  const [selectedTaskDomain, setSelectedTaskDomain] = useState<'auto' | TaskDomain>('auto');
  const [activeAppliedDomain, setActiveAppliedDomain] = useState<TaskDomain | null>(() => {
    return (localStorage.getItem('council_last_domain') as TaskDomain) || null;
  });

  const [autoSelectModels, setAutoSelectModels] = useState<boolean>(() => {
    const saved = localStorage.getItem('council_auto_select_models');
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return true;
      }
    }
    return true;
  });

  const [selectionDebugResult, setSelectionDebugResult] = useState<SmartSelectionResult | null>(null);

  const handleToggleAutoSelectModels = (enabled: boolean) => {
    setAutoSelectModels(enabled);
    localStorage.setItem('council_auto_select_models', JSON.stringify(enabled));
    if (enabled) {
      handleApplySmartDomainModelSelection(selectedTaskDomain);
    }
  };

  const handleApplySmartDomainModelSelection = (domainChoice: 'auto' | TaskDomain, overrideQuery?: string) => {
    setSelectedTaskDomain(domainChoice);
    const textFiles = attachedFiles.filter(f => !f.type?.startsWith('image/'));
    const effectiveQuery = overrideQuery !== undefined ? overrideQuery : query;
    const lastDomain = (activeAppliedDomain || localStorage.getItem('council_last_domain')) as TaskDomain | null;

    let domainToApply: TaskDomain;
    if (domainChoice === 'auto') {
      if (effectiveQuery.trim() || textFiles.length > 0) {
        domainToApply = detectTaskDomain(effectiveQuery, textFiles);
      } else if (lastDomain) {
        domainToApply = lastDomain;
      } else {
        domainToApply = 'general';
      }
    } else {
      domainToApply = domainChoice;
    }

    localStorage.setItem('council_last_domain', domainToApply);
    setActiveAppliedDomain(domainToApply);

    const isFreeOnly = activePresetId === 'fast_and_free' || activePresetId === 'fastest_cheapest';

    const result = applySmartModelSelection(domainToApply, personas, synthesizer, {
      availableModels,
      rawModelsCatalog,
      isFreeOnly,
      budget: activePresetId,
      autoSelectModels,
    });

    if (result.autoSelectEnabled) {
      setPersonas(result.updatedPersonas);
      setSynthesizer(result.updatedSynthesizer);
    }
    setSelectionDebugResult(result);
    return result;
  };

  const handleRefreshModels = React.useCallback(
    async (options?: { force?: boolean; applyToPersonas?: boolean }) => {
      const force = options?.force ?? true;
      const applyToPersonas = options?.applyToPersonas ?? false;

      // 1. Fetch catalog (use returned models directly, not stale state)
      const result = await refreshModelRecommendations({ force });
      const freshModels = result?.models || rawModelsCatalog;
      const freshAvailableModels = freshModels.map((m) => ({
        id: m.id,
        name: cleanModelName(m.id, m.name),
      }));

      // 2. Resolve domain: last applied domain, or detectTaskDomain(query, textFiles) if Auto, else 'general'.
      const textFiles = attachedFiles?.filter((f) => !f.type?.startsWith('image/')) || [];
      const lastDomain = (activeAppliedDomain || localStorage.getItem('council_last_domain')) as TaskDomain | null;

      let resolvedDomain: TaskDomain;
      if (selectedTaskDomain === 'auto') {
        if (query.trim() || textFiles.length > 0) {
          resolvedDomain = detectTaskDomain(query, textFiles);
        } else if (lastDomain) {
          resolvedDomain = lastDomain;
        } else {
          resolvedDomain = 'general';
        }
      } else {
        resolvedDomain = selectedTaskDomain;
      }

      // 3. Persist council_last_domain
      localStorage.setItem('council_last_domain', resolvedDomain);
      setActiveAppliedDomain(resolvedDomain);

      // 4. Run ONE assigner (smart selector)
      // 5. If active budget is Fast & Free, pass isFreeOnly and never promote paid models
      const isFreeOnly = activePresetId === 'fast_and_free' || activePresetId === 'fastest_cheapest';

      const smartSelection = applySmartModelSelection(
        resolvedDomain,
        personas,
        synthesizer,
        {
          availableModels: freshAvailableModels,
          rawModelsCatalog: freshModels,
          isFreeOnly,
          budget: activePresetId,
          autoSelectModels,
        }
      );

      setSelectionDebugResult(smartSelection);

      // 6. Catalog refresh must not mutate personas unless Auto-Select is ON or the user clicks Apply recommendations
      const shouldMutate = applyToPersonas || (selectedTaskDomain === 'auto' && autoSelectModels);

      if (shouldMutate && smartSelection.autoSelectEnabled) {
        setPersonas(smartSelection.updatedPersonas);
        setSynthesizer(smartSelection.updatedSynthesizer);

        // Persist model settings to localStorage
        const defaultModelsMap: Record<string, string> = {};
        smartSelection.updatedPersonas.forEach((p) => {
          defaultModelsMap[p.id] = p.model;
        });
        defaultModelsMap['synthesizer'] = smartSelection.updatedSynthesizer.model;
        localStorage.setItem('council_default_models', JSON.stringify(defaultModelsMap));
      }

      return result;
    },
    [
      refreshModelRecommendations,
      rawModelsCatalog,
      attachedFiles,
      activeAppliedDomain,
      selectedTaskDomain,
      query,
      activePresetId,
      personas,
      synthesizer,
      autoSelectModels,
    ]
  );

  const sessionCostMetrics = countTotalSessionCost(rounds);

  const handleApplyPreset = (presetId: PresetId) => {
    setActivePresetId(presetId);

    const textFiles = attachedFiles?.filter(f => !f.type?.startsWith('image/')) || [];
    const lastDomain = (activeAppliedDomain || localStorage.getItem('council_last_domain')) as TaskDomain | null;

    let domainToApply: TaskDomain;
    if (selectedTaskDomain === 'auto') {
      if (query.trim() || textFiles.length > 0) {
        domainToApply = detectTaskDomain(query, textFiles);
      } else if (lastDomain) {
        domainToApply = lastDomain;
      } else {
        domainToApply = 'general';
      }
    } else {
      domainToApply = selectedTaskDomain;
    }

    localStorage.setItem('council_last_domain', domainToApply);
    setActiveAppliedDomain(domainToApply);

    const isFreeOnly = presetId === 'fast_and_free' || presetId === 'fastest_cheapest';

    const smartSelection = applySmartModelSelection(
      domainToApply,
      personas,
      synthesizer,
      {
        availableModels,
        rawModelsCatalog,
        isFreeOnly,
        budget: presetId,
        autoSelectModels: true,
      }
    );

    setPersonas(smartSelection.updatedPersonas);
    setSynthesizer(smartSelection.updatedSynthesizer);
    setSelectionDebugResult(smartSelection);

    // Persist model settings to localStorage
    const defaultModelsMap: Record<string, string> = {};
    smartSelection.updatedPersonas.forEach(p => { defaultModelsMap[p.id] = p.model; });
    defaultModelsMap['synthesizer'] = smartSelection.updatedSynthesizer.model;
    localStorage.setItem('council_default_models', JSON.stringify(defaultModelsMap));
  };

  useEffect(() => {
    const models: Record<string, string> = {
      synthesizer: synthesizer.model || 'google/gemini-3.7-flash'
    };
    personas.forEach(p => {
      if (p.model) {
        models[p.id] = p.model;
      }
    });
    const modelsString = JSON.stringify(models);
    const saved = localStorage.getItem('council_default_models');
    if (saved !== modelsString) {
      localStorage.setItem('council_default_models', modelsString);
      setInternalSettings(prev => ({ ...prev, defaultModels: models }));
    }

    if (activeSessionId) {
      updateActiveSessionConfig({
        presetId: activePresetId,
        personas,
        synthesizer,
      });
    }
  }, [personas, synthesizer, activePresetId, activeSessionId, updateActiveSessionConfig]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [collapsedRoundIds, setCollapsedRoundIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!fileError) return;
    const t = window.setTimeout(() => setFileError(null), 6000);
    return () => window.clearTimeout(t);
  }, [fileError]);

  const estimatedQueryTokens = React.useMemo(() => {
    let text = query || '';
    if (attachedFiles && attachedFiles.length > 0) {
      text += '\n' + attachedFiles.map((f) => f.content || '').join('\n');
    }
    return estimateTokens(text);
  }, [query, attachedFiles]);

  const estimatedQueryCost = React.useMemo(() => {
    if (estimatedQueryTokens === 0) return 0;
    const activePersonas = personas.filter((p) => p.enabled !== false);
    if (activePersonas.length === 0) return 0;

    const isQuickMode = (settings.executionMode || 'auto') === 'quick_panel';
    let totalCost = 0;

    // Stage 1: Individual Persona Analysis
    activePersonas.forEach((p) => {
      totalCost += calculateCallCost(estimatedQueryTokens, 400, p.model);
    });

    // Stage 2: Peer Review (in deep_council or auto mode when not stopAfterStage1)
    if (!isQuickMode && !settings.stopAfterStage1) {
      activePersonas.forEach((p) => {
        const stage2InputTokens = estimatedQueryTokens + activePersonas.length * 400;
        totalCost += calculateCallCost(stage2InputTokens, 350, p.model);
      });
    }

    // Stage 3: Synthesis
    if (synthesizer && !settings.stopAfterStage1) {
      const synthInputTokens = estimatedQueryTokens + activePersonas.length * (isQuickMode ? 400 : 750);
      totalCost += calculateCallCost(synthInputTokens, 600, synthesizer.model);
    }

    return totalCost;
  }, [estimatedQueryTokens, personas, synthesizer, settings.executionMode, settings.stopAfterStage1]);

  const queryTokens = estimatedQueryTokens;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMainScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    // Show if scrolled up by more than 150px
    if (distanceFromBottom > 150) {
      setShowScrollBottom(true);
    } else {
      setShowScrollBottom(false);
    }
  };

  const toggleRoundCollapse = (roundId: string) => {
    setCollapsedRoundIds((prev) => {
      const next = new Set(prev);
      if (next.has(roundId)) next.delete(roundId);
      else next.add(roundId);
      return next;
    });
  };

  useEffect(() => {
    if (rounds.length > 0) {
      scrollToBottom();
    }
  }, [rounds.length, isDeliberating]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  ;

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsDeliberating(false);
    }
  };

  const updateMaxTokens = (val: number) => {
    const updated = { ...settings, maxTokens: val };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
    localStorage.setItem('council_max_tokens', val.toString());
  };

  const runSynthesisPhase = async (
    targetRoundId: string,
    queryText: string,
    attachedImages: { name: string; url: string; type: string }[] | undefined,
    stage1Map: Record<string, PersonaResponse>,
    stage2Map: Record<string, PersonaResponse>,
    signal: AbortSignal
  ) => {
    console.log(`[Synthesis Phase] Starting for round ${targetRoundId}...`);
    // Stage 3: Chairman Synthesis Phase
    dispatch({ type: 'START_SYNTHESIS', payload: { roundId: targetRoundId } });
    updateRoundInActiveSession(targetRoundId, (r) => ({
      ...r,
      synthesis: { content: '', status: 'streaming' },
    }));

    const stage1Text = Object.values(stage1Map || {})
      .filter((resp) => resp.personaId !== 'synthesizer')
      .map((resp) => {
        const p = personas.find((item) => item.id === resp.personaId);
        return `### ${p?.name || resp.personaId} (${p?.role}):\n${resp.content || '[No output/Error]'}`;
      })
      .join('\n\n');

    const stage2Text = Object.values(stage2Map || {})
      .filter((resp) => resp.personaId !== 'synthesizer')
      .map((resp) => {
        const p = personas.find((item) => item.id === resp.personaId);
        return `### ${p?.name || resp.personaId} (${p?.role}):\n${resp.content || '[No output/Error]'}`;
      })
      .join('\n\n');

    const queryContentStr = `User Question: "${queryText}"\n\n--- STAGE 1: INITIAL PROPOSALS ---\n${stage1Text}\n\n--- STAGE 2: PEER REVIEWS & CROSS-EXAMINATION ---\n${stage2Text || '(Stage 2 empty or bypassed)'}`;

    const chairmanMessages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
      { role: 'system', content: synthesizer.systemPrompt || CHAIRMAN_PROMPT },
    ];
    
    if (attachedImages && attachedImages.length > 0) {
      chairmanMessages.push({
        role: 'user' as const,
        content: [
          { type: 'text', text: queryContentStr },
          ...attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } }))
        ] as any
      });
    } else {
      chairmanMessages.push({
        role: 'user' as const,
        content: queryContentStr as any
      });
    }

    let fullSynthesis = '';

    try {
      const targetSynthModel = (synthesizer?.model || settings?.defaultModels?.['synthesizer'] || 'google/gemini-3.7-flash').trim() || 'google/gemini-3.7-flash';
      console.log(`[Synthesis Phase] Initiating stream with model: ${targetSynthModel}`);
      console.log(`[Synthesis Phase] Messages payload length: ${JSON.stringify(chairmanMessages).length} chars`);
      
      let streamGroundingData: any = undefined;

      const streamPromise = streamPersona({
        personaId: 'synthesizer',
        apiKey: settings.apiKey,
        model: targetSynthModel,
        messages: chairmanMessages,
        temperature: 0.5,
        maxTokens: Math.min(Math.max((settings.maxTokens || 4000) * 2, 8000), 8192),
        enableSearchGrounding: Boolean(settings.enableSearchGrounding || synthesizer.enableSearchGrounding),
        webMode: settings.webMode || 'auto',
        enableWebGrounding: settings.webMode === 'always' || (settings.webMode !== 'off' && Boolean(settings.enableSearchGrounding || synthesizer.enableSearchGrounding)),
        query: queryText,
        signal,
        disableFallback: Boolean(settings.disableFallback),
        onGrounding: (gData) => { streamGroundingData = gData; },
        onToken: (chunk) => {
          if (!fullSynthesis) {
            console.log(`[Synthesis Phase] First token received for round ${targetRoundId}`);
          }
          fullSynthesis += chunk;
          dispatch({ type: 'UPDATE_SYNTHESIS_TOKEN', payload: { roundId: targetRoundId, chunk } });

          const hasCodeArchive = Boolean(
            queryText.includes('[CODEBASE FILE CONTENTS]') ||
            queryText.includes('[CODEBASE FILE TREE]') ||
            queryText.includes('--- Attached File:') ||
            (attachedImages && attachedImages.length > 0)
          );
          if (hasCodeArchive) {
            const refusalCheck = detectCodeCapabilityRefusal(fullSynthesis, true);
            if (refusalCheck.isRefusal) {
              console.warn(`[CapabilityGuard] Synthesizer refused code reading:`, refusalCheck.snippet);
              const failure: CapabilityFailure = {
                personaId: 'synthesizer',
                personaName: synthesizer.name || 'Chairman',
                model: targetSynthModel,
                stage: 3,
                reason: 'Chairman stated it cannot read code archive or inspect source files.',
                detectedSnippet: refusalCheck.snippet,
              };
              updateRoundInActiveSession(targetRoundId, (r) => ({
                ...r,
                capabilityFailure: failure,
              }));
              showToast(`Deliberation halted: Chairman (${targetSynthModel}) reported inability to read the codebase.`, 6000);
            }
          }
        },
      });

      console.log(`[Synthesis Phase] Awaiting stream completion for round ${targetRoundId}...`);
      const synthRes = await streamPromise;
      console.log(`[Synthesis Phase] Stream completed successfully. Total length: ${fullSynthesis.length} characters.`);

      const finalSynthGrounding = synthRes?.grounding || streamGroundingData;
      const executedSynthModel = synthRes?.finalModel || targetSynthModel;

      dispatch({ type: 'FINISH_SYNTHESIS', payload: { roundId: targetRoundId, grounding: finalSynthGrounding, model: executedSynthModel } });
      updateRoundInActiveSession(targetRoundId, (r) => ({
        ...r,
        synthesis: { ...r.synthesis, content: fullSynthesis, status: 'completed', grounding: finalSynthGrounding, model: executedSynthModel },
      }));
      console.log(`[Synthesis Phase] Finished successfully for round ${targetRoundId}`);

      // Deliberation completion notifications
      const notifPrefs = settings.notificationPreferences;
      if (notifPrefs?.enableSoundAlerts !== false && notifPrefs?.notifyOnDeliberationComplete !== false) {
        playNotificationChime('complete', notifPrefs?.soundVolume ?? 0.5);
      }
      if (notifPrefs?.enableBrowserNotifications && notifPrefs?.notifyOnDeliberationComplete !== false) {
        sendDesktopNotification('🏛️ Council Deliberation Complete', 'Stage 3 synthesis and verdict are ready to review.');
      }

      return fullSynthesis;
    } catch (err: any) {
      console.error(`[Synthesis Phase] ERROR encountered during stream for round ${targetRoundId}:`, err);
      if (err.name !== 'AbortError') {
        const errorMsg = err.message || 'Chairman synthesis failed';
        console.error('[Synthesis Phase] Dispatching error state due to:', errorMsg);
        dispatch({ type: 'ERROR_SYNTHESIS', payload: { roundId: targetRoundId, error: errorMsg } });
        updateRoundInActiveSession(targetRoundId, (r) => ({
          ...r,
          synthesis: {
            ...r.synthesis,
            status: 'error',
            error: errorMsg,
          },
        }));

        // Error notification
        const notifPrefs = settings.notificationPreferences;
        if (notifPrefs?.enableSoundAlerts !== false && notifPrefs?.notifyOnError !== false) {
          playNotificationChime('error', notifPrefs?.soundVolume ?? 0.5);
        }
        if (notifPrefs?.enableBrowserNotifications && notifPrefs?.notifyOnError !== false) {
          sendDesktopNotification('⚠️ Deliberation Error', errorMsg);
        }
      } else {
        console.warn(`[Synthesis Phase] Stream was aborted for round ${targetRoundId}`);
      }
      return '';
    }
  };

  const buildAndSaveAuditLog = async (
    roundId: string,
    userQuery: string,
    presetName: string,
    answerMode: string,
    activePersonas: Persona[],
    synthesizer: Persona,
    stage1Outputs: Record<string, PersonaResponse>,
    stage2Outputs: Record<string, PersonaResponse>,
    synthesisResponse: { content: string; model?: string },
    totalWallClockMs: number,
    roundFallbackLogs: FallbackEvent[],
    isProCompareActive: boolean,
    apiKey: string,
    signal?: AbortSignal
  ) => {
    const logId = `audit_${roundId}_${Date.now()}`;
    const modelAudits: ModelRequestAudit[] = [];

    // Stage 1 & 2 Persona Audits
    activePersonas.forEach((p) => {
      const selectedModelId = p.model || settings?.defaultModels?.[p.id] || 'google/gemini-3.7-flash';
      const s1Resp = stage1Outputs[p.id];
      const resolvedModelId = s1Resp?.model || selectedModelId;
      const authorOrg = getAuthorOrganization(resolvedModelId);

      const promptTokens = s1Resp?.promptTokens || estimateTokens(userQuery);
      const completionTokens = s1Resp?.completionTokens || estimateTokens(s1Resp?.content || '');
      const totalTokens = promptTokens + completionTokens;
      const cost = calculateCallCost(promptTokens, completionTokens, resolvedModelId);
      const scores = calculateScoresForModel(resolvedModelId, resolvedModelId.includes(':free'));

      const fallbackForPersona = roundFallbackLogs.find((f) => f.personaId === p.id);

      modelAudits.push({
        personaId: p.id,
        selectedModelId,
        resolvedModelId,
        authorOrg,
        latencyMs: Math.round(totalWallClockMs / 2),
        promptTokens,
        completionTokens,
        totalTokens,
        cost,
        scores,
        ...(fallbackForPersona ? { fallbackEvent: { reason: fallbackForPersona.triggerReason, replacementModel: fallbackForPersona.replacementModel || '' } } : {}),
      });
    });

    // Synthesizer Audit
    const synthSelectedModel = synthesizer?.model || settings?.defaultModels?.['synthesizer'] || 'google/gemini-3.7-flash';
    const synthResolvedModel = synthesisResponse.model || synthSelectedModel;
    const synthPromptTokens = estimateTokens(userQuery);
    const synthCompletionTokens = estimateTokens(synthesisResponse.content || '');
    const synthTotalTokens = synthPromptTokens + synthCompletionTokens;
    const synthCost = calculateCallCost(synthPromptTokens, synthCompletionTokens, synthResolvedModel);

    modelAudits.push({
      personaId: 'synthesizer',
      selectedModelId: synthSelectedModel,
      resolvedModelId: synthResolvedModel,
      authorOrg: getAuthorOrganization(synthResolvedModel),
      latencyMs: Math.round(totalWallClockMs / 3),
      promptTokens: synthPromptTokens,
      completionTokens: synthCompletionTokens,
      totalTokens: synthTotalTokens,
      cost: synthCost,
      scores: calculateScoresForModel(synthResolvedModel, synthResolvedModel.includes(':free')),
    });

    const totalPromptTokens = modelAudits.reduce((acc, m) => acc + m.promptTokens, 0);
    const totalCompletionTokens = modelAudits.reduce((acc, m) => acc + m.completionTokens, 0);
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const totalCost = modelAudits.reduce((acc, m) => acc + m.cost, 0);
    const panelSuccessCount = activePersonas.filter((p) => stage1Outputs[p.id]?.status === 'completed').length;

    let proComparisonData: any = undefined;
    let proComparisonAuditObj: any = undefined;

    // Phase 2: Blind Pro Comparison Execution if enabled
    if (isProCompareActive && apiKey) {
      try {
        const proModelId = settings.proCompareModelId || 'anthropic/claude-3.7-sonnet';
        const proStart = Date.now();
        const proRes = await streamOpenRouterCompletion({
          apiKey,
          model: proModelId,
          messages: [
            { role: 'system', content: PRO_MODEL_SYSTEM_PROMPT },
            { role: 'user', content: userQuery },
          ],
          temperature: 0.5,
          maxTokens: 2000,
          signal,
        });
        const proLatencyMs = Date.now() - proStart;
        const proPromptTokens = estimateTokens(userQuery);
        const proCompletionTokens = estimateTokens(proRes.content || '');
        const proCost = calculateCallCost(proPromptTokens, proCompletionTokens, proModelId);
        const answerAIsCouncil = Math.random() < 0.5;

        proComparisonAuditObj = {
          proModelId,
          proModelOrg: getAuthorOrganization(proModelId),
          answerAIsCouncil,
          councilLatencyMs: totalWallClockMs,
          proLatencyMs,
          councilCost: totalCost,
          proCost,
        };

        proComparisonData = {
          auditLogId: logId,
          proModelId,
          proContent: proRes.content,
          councilLatencyMs: totalWallClockMs,
          proLatencyMs,
          councilCost: totalCost,
          proCost,
          answerAIsCouncil,
        };
      } catch (err) {
        console.warn('Phase 2 Blind Pro Comparison failed:', err);
      }
    }

    const auditLogRecord: CouncilRequestAuditLog = {
      id: logId,
      timestamp: Date.now(),
      presetName: presetName.replace('_', ' ').toUpperCase(),
      answerMode,
      totalWallClockMs,
      panelSuccessCount,
      panelTotalCount: activePersonas.length,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCost,
      modelAudits,
      fallbackEvents: roundFallbackLogs.map((f) => ({
        personaId: f.personaId,
        originalModel: f.originalModel,
        replacementModel: f.replacementModel || '',
        reason: f.triggerReason,
      })),
      proComparison: proComparisonAuditObj,
    };

    saveAuditLog(auditLogRecord);

    if (proComparisonData) {
      updateRoundInActiveSession(roundId, (r) => ({
        ...r,
        auditLogId: logId,
        proComparisonData,
      }));
    }

    return { auditLogId: logId, proComparisonData };
  };

  ;

  const handleRegeneratePersona = async (roundId: string, personaId: string, stage: 1 | 2) => {
    if (!acquireDeliberationLock()) return;

    const round = rounds.find((r) => r.id === roundId);
    if (!round) {
      releaseDeliberationLock();
      return;
    }

    const persona = personas.find((p) => p.id === personaId);
    if (!persona) {
      releaseDeliberationLock();
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const executionPolicy = policyForPreset(activePresetId);
      const activePersonas = personas.filter((p) => p.enabled !== false);
      const personaModel = persona.model || settings?.defaultModels?.[personaId];
      if (!personaModel) {
        throw new Error(`No model assigned for persona ${persona.name}`);
      }

      if (stage === 1) {
        const stage1State = round.deliberation?.stage1 || {};
        dispatch({
          type: 'START_STAGE1',
          payload: {
            roundId,
            initialStage1: {
              ...stage1State,
              [personaId]: { personaId, content: '', status: 'streaming' },
            },
          },
        });

        const messages = await buildArchivistContext({
          systemPrompt: persona.systemPrompt,
          userQuery: round.userQuery,
          attachedImages: round.attachedImages,
          rounds: rounds.filter((r) => r.id !== roundId),
          apiKey: settings.apiKey,
          recentRoundsWindow: settings.archivistRecentRounds ?? 2,
          onSummaryGenerated: (summary) => {
            updateRoundInActiveSession(roundId, (r) => ({ ...r, archivistSummary: summary }));
          },
        });

        let fullContent = '';
        let streamGroundingData: any = undefined;

        const res1 = await streamPersonaWithFallback({
          personaId,
          personaName: persona.name,
          roundId,
          apiKey: settings.apiKey,
          model: personaModel,
          messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens || executionPolicy.maxOutputTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          webMode: settings.webMode || 'auto',
          enableWebGrounding: settings.webMode === 'always' || (settings.webMode !== 'off' && Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding)),
          query: round.userQuery,
          signal: abortController.signal,
          disableFallback: Boolean(settings.disableFallback),
          activePersonas,
          synthesizer,
          rawModels: rawModelsCatalog,
          isFreeOnlyPreset: executionPolicy.budget === 'free',
          onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
          onGrounding: (gData) => { streamGroundingData = gData; },
          onToken: (chunk) => {
            fullContent += chunk;
            dispatch({
              type: 'UPDATE_STAGE1_TOKEN',
              payload: { roundId, personaId, chunk },
            });
          },
        });

        const finalGrounding1 = res1?.grounding || streamGroundingData;
        const executedModel1 = res1?.finalModel || personaModel;

        dispatch({
          type: 'FINISH_STAGE1_PERSONA',
          payload: { roundId, personaId, content: fullContent, grounding: finalGrounding1, model: executedModel1 },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [personaId]: { personaId, content: fullContent, status: 'completed', grounding: finalGrounding1, model: executedModel1 },
            },
          },
        }));
      } else {
        const stage1Map = round.deliberation?.stage1 || {};
        const peerProposals = Object.values(stage1Map)
          .filter((resp: PersonaResponse | any) => resp?.personaId !== personaId && resp?.personaId !== 'synthesizer')
          .map((resp: PersonaResponse | any) => {
            const p = personas.find((item) => item.id === resp.personaId);
            return `### ${p?.name || resp.personaId} (${p?.role}):\n${resp.content || '[No proposal]'}`;
          })
          .join('\n\n');

        const queryContentStr = `User Question: "${round.userQuery}"\n\n--- Initial Stage 1 Proposals from Other Council Members ---\n${peerProposals}\n\nTask: Peer review the proposals above. Point out unaddressed risks, test assumptions, highlight valuable ideas, and refine your position.`;

        const stage2Messages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
          { role: 'system', content: persona.systemPrompt },
        ];

        if (round.attachedImages && round.attachedImages.length > 0) {
          stage2Messages.push({
            role: 'user' as const,
            content: [
              { type: 'text', text: queryContentStr },
              ...round.attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } }))
            ] as any
          });
        } else {
          stage2Messages.push({
            role: 'user' as const,
            content: queryContentStr as any
          });
        }

        const stage2State = round.deliberation?.stage2 || {};
        dispatch({
          type: 'START_STAGE2',
          payload: {
            roundId,
            initialStage2: {
              ...stage2State,
              [personaId]: { personaId, content: '', status: 'streaming' },
            },
          },
        });

        let fullContent = '';
        let streamGroundingData2: any = undefined;

        const res2 = await streamPersonaWithFallback({
          personaId,
          personaName: persona.name,
          roundId,
          apiKey: settings.apiKey,
          model: personaModel,
          messages: stage2Messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens || executionPolicy.maxOutputTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          webMode: settings.webMode || 'auto',
          enableWebGrounding: settings.webMode === 'always' || (settings.webMode !== 'off' && Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding)),
          query: round.userQuery,
          signal: abortController.signal,
          disableFallback: Boolean(settings.disableFallback),
          activePersonas,
          synthesizer,
          rawModels: rawModelsCatalog,
          isFreeOnlyPreset: executionPolicy.budget === 'free',
          onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
          onGrounding: (gData) => { streamGroundingData2 = gData; },
          onToken: (chunk) => {
            fullContent += chunk;
            dispatch({
              type: 'UPDATE_STAGE2_TOKEN',
              payload: { roundId, personaId, chunk },
            });
          },
        });

        const finalGrounding2 = res2?.grounding || streamGroundingData2;
        const executedModel2 = res2?.finalModel || personaModel;

        dispatch({
          type: 'FINISH_STAGE2_PERSONA',
          payload: { roundId, personaId, content: fullContent, grounding: finalGrounding2, model: executedModel2 },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [personaId]: { personaId, content: fullContent, status: 'completed', grounding: finalGrounding2, model: executedModel2 },
            },
          },
        }));
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errorMsg = err.message || 'Persona regeneration failed';
        if (stage === 1) {
          dispatch({ type: 'ERROR_STAGE1_PERSONA', payload: { roundId, personaId, error: errorMsg } });
        } else {
          dispatch({ type: 'ERROR_STAGE2_PERSONA', payload: { roundId, personaId, error: errorMsg } });
        }
      }
    } finally {
      releaseDeliberationLock();
      abortControllerRef.current = null;
    }
  };

  const getRoundIncompleteStage = (round: CouncilRound, activePersonas: Persona[]): { isIncomplete: boolean; stage: 1 | 2 | 3; description: string } => {
    const stage1Map = round.deliberation?.stage1 || {};
    const stage2Map = round.deliberation?.stage2 || {};
    const isMultiPersona = activePersonas.length > 1;

    const incompleteStage1Personas = activePersonas.filter((p) => {
      const resp = stage1Map[p.id];
      return !resp || resp.status !== 'completed' || !resp.content?.trim();
    });

    if (incompleteStage1Personas.length > 0) {
      return {
        isIncomplete: true,
        stage: 1,
        description: `Stage 1 Proposals (${incompleteStage1Personas.length} member${incompleteStage1Personas.length > 1 ? 's' : ''} pending)`,
      };
    }

    if (isMultiPersona) {
      const incompleteStage2Personas = activePersonas.filter((p) => {
        const resp = stage2Map[p.id];
        return !resp || resp.status !== 'completed' || !resp.content?.trim();
      });

      if (incompleteStage2Personas.length > 0) {
        return {
          isIncomplete: true,
          stage: 2,
          description: `Stage 2 Peer Review (${incompleteStage2Personas.length} member${incompleteStage2Personas.length > 1 ? 's' : ''} pending)`,
        };
      }

      if (!round.synthesis?.content?.trim() || round.synthesis?.status !== 'completed') {
        return {
          isIncomplete: true,
          stage: 3,
          description: 'Stage 3 Council Synthesis',
        };
      }
    }

    return { isIncomplete: false, stage: 1, description: 'Complete' };
  };

  const resumeIncompleteRound = async (roundId: string) => {
    if (!acquireDeliberationLock()) return;

    const round = rounds.find((r) => r.id === roundId);
    if (!round) {
      releaseDeliberationLock();
      return;
    }

    const activePersonas = personas.filter((p) => p.enabled !== false);
    if (activePersonas.length === 0) {
      releaseDeliberationLock();
      alert('Please enable at least one council member persona to start deliberation.');
      return;
    }

    const { isIncomplete, stage: startStage } = getRoundIncompleteStage(round, activePersonas);
    if (!isIncomplete) {
      releaseDeliberationLock();
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const stage1Map: Record<string, PersonaResponse> = { ...(round.deliberation?.stage1 || {}) };
    const stage2Map: Record<string, PersonaResponse> = { ...(round.deliberation?.stage2 || {}) };

    try {
      const executionPolicy = policyForPreset(activePresetId);

      // PHASE 1: RESUME STAGE 1 IF NEEDED
      if (startStage === 1) {
        const pendingStage1Personas = activePersonas.filter((p) => {
          const resp = stage1Map[p.id];
          return !resp || resp.status !== 'completed' || !resp.content?.trim();
        });

        const initialStage1Update: Record<string, PersonaResponse> = { ...stage1Map };
        pendingStage1Personas.forEach((p) => {
          initialStage1Update[p.id] = { personaId: p.id, content: '', status: 'streaming' };
        });

        dispatch({ type: 'START_STAGE1', payload: { roundId, initialStage1: initialStage1Update } });
        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: { ...r.deliberation, stage1: initialStage1Update },
        }));

        const stage1Promises = pendingStage1Personas.map(async (persona) => {
          const personaModel = persona.model || settings?.defaultModels?.[persona.id];
          if (!personaModel) {
            throw new Error(`No model assigned for persona ${persona.name}`);
          }

          const messages = await buildArchivistContext({
            systemPrompt: persona.systemPrompt,
            userQuery: round.userQuery,
            attachedImages: round.attachedImages,
            rounds: rounds.filter((r) => r.id !== roundId),
            apiKey: settings.apiKey,
            recentRoundsWindow: settings.archivistRecentRounds ?? 2,
            signal: abortController.signal,
            onSummaryGenerated: (summary) => {
              updateRoundInActiveSession(roundId, (r) => ({ ...r, archivistSummary: summary }));
            },
          });

          let content = '';
          try {
            const res1 = await streamPersonaWithFallback({
              personaId: persona.id,
              personaName: persona.name,
              roundId,
              apiKey: settings.apiKey,
              model: personaModel,
              messages,
              temperature: settings.temperature,
              maxTokens: settings.maxTokens || executionPolicy.maxOutputTokens,
              enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
              webMode: settings.webMode || 'auto',
              enableWebGrounding: settings.webMode === 'always' || (settings.webMode !== 'off' && Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding)),
              query: round.userQuery,
              signal: abortController.signal,
              disableFallback: Boolean(settings.disableFallback),
              activePersonas,
              synthesizer,
              rawModels: rawModelsCatalog,
              isFreeOnlyPreset: executionPolicy.budget === 'free',
              onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
              onToken: (chunk) => {
                content += chunk;
                dispatch({ type: 'UPDATE_STAGE1_TOKEN', payload: { roundId, personaId: persona.id, chunk } });
              },
            });

            const executedModel1 = res1?.finalModel || personaModel;
            stage1Map[persona.id] = { personaId: persona.id, content, status: 'completed', model: executedModel1 };
            dispatch({ type: 'FINISH_STAGE1_PERSONA', payload: { roundId, personaId: persona.id, content, model: executedModel1 } });
            updateRoundInActiveSession(roundId, (r) => ({
              ...r,
              deliberation: {
                ...r.deliberation,
                stage1: { ...r.deliberation?.stage1, [persona.id]: { personaId: persona.id, content, status: 'completed', model: executedModel1 } },
              },
            }));
          } catch (err: any) {
            if (err.name === 'AbortError') return;
            const errorMsg = err.message || 'Failed Stage 1 query';
            stage1Map[persona.id] = { personaId: persona.id, content, status: 'error', error: errorMsg };
            dispatch({ type: 'ERROR_STAGE1_PERSONA', payload: { roundId, personaId: persona.id, error: errorMsg } });
          }
        });

        await Promise.allSettled(stage1Promises);
        if (abortController.signal.aborted) return;
      }

      // Skip Stage 2 and Stage 3 if single council member
      if (activePersonas.length === 1) {
        return;
      }

      // PHASE 2: RESUME STAGE 2 IF NEEDED
      if (startStage <= 2) {
        const pendingStage2Personas = activePersonas.filter((p) => {
          const resp = stage2Map[p.id];
          return !resp || resp.status !== 'completed' || !resp.content?.trim();
        });

        if (pendingStage2Personas.length > 0) {
          const initialStage2Update: Record<string, PersonaResponse> = { ...stage2Map };
          pendingStage2Personas.forEach((p) => {
            initialStage2Update[p.id] = { personaId: p.id, content: '', status: 'streaming' };
          });

          dispatch({ type: 'START_STAGE2', payload: { roundId, initialStage2: initialStage2Update } });
          updateRoundInActiveSession(roundId, (r) => ({
            ...r,
            deliberation: { ...r.deliberation, stage2: initialStage2Update },
          }));

          const stage2Promises = pendingStage2Personas.map(async (persona) => {
            const personaModel = persona.model || settings?.defaultModels?.[persona.id];
            if (!personaModel) {
              throw new Error(`No model assigned for persona ${persona.name}`);
            }

            const peerProposals = Object.values(stage1Map)
              .filter((resp: any) => resp?.personaId !== persona.id && resp?.personaId !== 'synthesizer')
              .map((resp: any) => {
                const p = personas.find((item) => item.id === resp.personaId);
                return `### ${p?.name || resp.personaId} (${p?.role}):\n${resp.content || '[No proposal]'}`;
              })
              .join('\n\n');

            const queryContentStr = `User Question: "${round.userQuery}"\n\n--- Initial Stage 1 Proposals from Other Council Members ---\n${peerProposals}\n\nTask: Peer review the proposals above. Point out unaddressed risks, test assumptions, highlight valuable ideas, and refine your position.`;
            
            const stage2Messages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
              { role: 'system', content: persona.systemPrompt },
            ];

            if (round.attachedImages && round.attachedImages.length > 0) {
              stage2Messages.push({
                role: 'user' as const,
                content: [
                  { type: 'text', text: queryContentStr },
                  ...round.attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } }))
                ] as any
              });
            } else {
              stage2Messages.push({
                role: 'user' as const,
                content: queryContentStr as any
              });
            }

            let content = '';
            try {
              const res2 = await streamPersonaWithFallback({
                personaId: persona.id,
                personaName: persona.name,
                roundId,
                apiKey: settings.apiKey,
                model: personaModel,
                messages: stage2Messages,
                temperature: settings.temperature,
                maxTokens: settings.maxTokens || executionPolicy.maxOutputTokens,
                enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
                webMode: settings.webMode || 'auto',
                enableWebGrounding: settings.webMode === 'always' || (settings.webMode !== 'off' && Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding)),
                query: round.userQuery,
                signal: abortController.signal,
                disableFallback: Boolean(settings.disableFallback),
                activePersonas,
                synthesizer,
                rawModels: rawModelsCatalog,
                isFreeOnlyPreset: executionPolicy.budget === 'free',
                onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
                onToken: (chunk) => {
                  content += chunk;
                  dispatch({ type: 'UPDATE_STAGE2_TOKEN', payload: { roundId, personaId: persona.id, chunk } });
                },
              });

              const executedModel2 = res2?.finalModel || personaModel;
              stage2Map[persona.id] = { personaId: persona.id, content, status: 'completed', model: executedModel2 };
              dispatch({ type: 'FINISH_STAGE2_PERSONA', payload: { roundId, personaId: persona.id, content, model: executedModel2 } });
              updateRoundInActiveSession(roundId, (r) => ({
                ...r,
                deliberation: {
                  ...r.deliberation,
                  stage2: { ...r.deliberation?.stage2, [persona.id]: { personaId: persona.id, content, status: 'completed', model: executedModel2 } },
                },
              }));
            } catch (err: any) {
              if (err.name === 'AbortError') return;
              const errorMsg = err.message || 'Failed Stage 2 peer review';
              stage2Map[persona.id] = { personaId: persona.id, content, status: 'error', error: errorMsg };
              dispatch({ type: 'ERROR_STAGE2_PERSONA', payload: { roundId, personaId: persona.id, error: errorMsg } });
            }
          });

          await Promise.allSettled(stage2Promises);
          if (abortController.signal.aborted) return;
        }
      }

      // PHASE 3: RESUME STAGE 3 (SYNTHESIS)
      await runSynthesisPhase(roundId, round.userQuery, round.attachedImages, stage1Map, stage2Map, abortController.signal);
    } finally {
      releaseDeliberationLock();
      abortControllerRef.current = null;
    }
  };

  const runRoundExecution = async (
    roundId: string,
    queryText: string,
    attachedImages: { name: string; url: string; type: string }[] | undefined,
    mode: ResolvedExecutionMode,
    isIsolated: boolean = false
  ) => {
    if (!acquireDeliberationLock()) return;
    const roundStartMs = Date.now();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Apply smart LLM model selection across all personalities based on domain type
    const textFiles = attachedFiles?.filter(f => !f.type?.startsWith('image/')) || [];
    const lastDomain = (activeAppliedDomain || localStorage.getItem('council_last_domain')) as TaskDomain | null;

    let domainToApply: TaskDomain;
    if (selectedTaskDomain === 'auto') {
      if (queryText.trim() || textFiles.length > 0) {
        domainToApply = detectTaskDomain(queryText, textFiles);
      } else if (lastDomain) {
        domainToApply = lastDomain;
      } else {
        domainToApply = 'general';
      }
    } else {
      domainToApply = selectedTaskDomain;
    }

    localStorage.setItem('council_last_domain', domainToApply);
    setActiveAppliedDomain(domainToApply);

    const isFreeOnly = activePresetId === 'fast_and_free' || activePresetId === 'fastest_cheapest';
    const executionPolicy = policyForPreset(activePresetId);

    const smartSelection = applySmartModelSelection(domainToApply, personas, synthesizer, {
      availableModels,
      rawModelsCatalog,
      isFreeOnly,
      autoSelectModels,
    });
    setActiveAppliedDomain(smartSelection.domain);
    setSelectionDebugResult(smartSelection);

    let activePersonas = personas.filter((p) => p.enabled !== false);
    let currentSynthesizer = synthesizer;

    if (smartSelection.autoSelectEnabled) {
      activePersonas = smartSelection.updatedPersonas.filter((p) => p.enabled !== false);
      currentSynthesizer = smartSelection.updatedSynthesizer;
      setPersonas(smartSelection.updatedPersonas);
      setSynthesizer(smartSelection.updatedSynthesizer);
    }

    const letters = ['A', 'B', 'C', 'D'];

    const initialStage1: Record<string, PersonaResponse> = {};
    const initialStage2: Record<string, PersonaResponse> = {};
    activePersonas.forEach((p) => {
      initialStage1[p.id] = { personaId: p.id, content: '', status: 'streaming' };
      initialStage2[p.id] = { personaId: p.id, content: '', status: 'idle' };
    });

    dispatch({
      type: 'START_STAGE1',
      payload: { roundId, initialStage1 },
    });

    updateRoundInActiveSession(roundId, (r) => ({
      ...r,
      resolvedMode: mode,
      isIsolatedRound: isIsolated,
      deliberation: {
        stage1: initialStage1,
        stage2: mode === 'deep_council' ? initialStage2 : {},
      },
      synthesis: { content: '', status: 'idle' },
    }));

    const stage1Outputs: Record<string, PersonaResponse> = {};

    const stage1Promises = activePersonas.map(async (persona, idx) => {
      let perCallSignal = abortController.signal;
      if (mode === 'quick_panel') {
        const timeoutMs = (settings.panelTimeoutSeconds || 30) * 1000;
        perCallSignal = (AbortSignal as any).any
          ? (AbortSignal as any).any([abortController.signal, AbortSignal.timeout(timeoutMs)])
          : abortController.signal;
      }

      const previousRoundsToPass = isIsolated ? [] : rounds.filter((r) => r.id !== roundId);
      const sessionFiles = activeSession?.attachedFiles || (attachedFiles.length > 0 ? attachedFiles.map((f) => ({
        name: f.name,
        type: f.type || 'text/plain',
        size: f.size,
        content: f.content,
        summary: f.unzippedResult
          ? `${f.unzippedResult.extractedCodeFilesCount} code files extracted (${Math.round(f.size / 1024)} KB)`
          : `${Math.round(f.content.length / 1000)}k chars (${Math.round(f.size / 1024)} KB)`,
      })) : undefined);

      const messages = await buildArchivistContext({
        systemPrompt: persona.systemPrompt,
        userQuery: queryText,
        attachedImages,
        sessionFiles,
        rounds: previousRoundsToPass,
        apiKey: settings.apiKey,
        recentRoundsWindow: settings.archivistRecentRounds ?? 2,
        signal: perCallSignal,
        onSummaryGenerated: (summary) => {
          updateRoundInActiveSession(roundId, (r) => ({ ...r, archivistSummary: summary }));
        },
      });

      let content = '';
      let streamGroundingData: any = undefined;

      try {
        const res = await streamPersonaWithFallback({
          personaId: persona.id,
          personaName: persona.name,
          roundId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[persona.id] || LATEST_GEMINI_FLASH,
          messages,
          temperature: settings.temperature,
          maxTokens: mode === 'quick_panel' ? (settings.quickPanelMaxTokens || 350) : settings.maxTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          webMode: settings.webMode || 'auto',
          enableWebGrounding: settings.webMode === 'always' || (settings.webMode !== 'off' && Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding)),
          query: queryText,
          signal: perCallSignal,
          disableFallback: Boolean(settings.disableFallback),
          activePersonas,
          synthesizer,
          rawModels: rawModelsCatalog,
          isFreeOnlyPreset: activePersonas.every((p) => (p.model || '').includes(':free')),
          onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
          onGrounding: (gData) => { streamGroundingData = gData; },
          onToken: (chunk) => {
            content += chunk;
            dispatch({
              type: 'UPDATE_STAGE1_TOKEN',
              payload: { roundId, personaId: persona.id, chunk },
            });

            const hasCodeArchive = Boolean(
              (attachedFiles && attachedFiles.some((f) => f.unzippedResult || f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.rar') || f.content?.includes('[CODEBASE FILE CONTENTS]'))) ||
              (activeSession?.attachedFiles && activeSession.attachedFiles.some((f) => f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.rar') || f.content?.includes('[CODEBASE FILE CONTENTS]'))) ||
              queryText.includes('[CODEBASE FILE CONTENTS]') ||
              queryText.includes('[CODEBASE FILE TREE]')
            );
            if (hasCodeArchive) {
              const refusalCheck = detectCodeCapabilityRefusal(content, true);
              if (refusalCheck.isRefusal) {
                console.warn(`[CapabilityGuard] Stage 1 Persona ${persona.name} refused code reading:`, refusalCheck.snippet);
                const executedModel = persona.model || settings.defaultModels[persona.id] || 'Unknown';
                const failure: CapabilityFailure = {
                  personaId: persona.id,
                  personaName: persona.name,
                  model: executedModel,
                  stage: 1,
                  reason: 'Model reported inability to read code archive or inspect source files.',
                  detectedSnippet: refusalCheck.snippet,
                };
                abortController.abort();
                updateRoundInActiveSession(roundId, (r) => ({
                  ...r,
                  capabilityFailure: failure,
                }));
                showToast(`Deliberation halted: ${persona.name} (${executedModel}) reported inability to read the codebase.`, 6000);
              }
            }
          },
        });

        const finalGrounding = res?.grounding || streamGroundingData;
        const executedModel = res?.finalModel || persona.model || settings.defaultModels[persona.id];

        stage1Outputs[persona.id] = {
          personaId: persona.id,
          content: res.content || content,
          status: 'completed',
          grounding: finalGrounding,
          model: executedModel,
        };

        dispatch({
          type: 'FINISH_STAGE1_PERSONA',
          payload: { roundId, personaId: persona.id, content: res.content || content, grounding: finalGrounding, model: executedModel },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [persona.id]: { personaId: persona.id, content: res.content || content, status: 'completed', grounding: finalGrounding, model: executedModel },
            },
          },
        }));
      } catch (err: any) {
        if (err.name === 'AbortError' && abortController.signal.aborted) return;
        const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout') || err.name === 'AbortError';
        const errorMsg = isTimeout ? 'Panelist timed out or failed to respond' : (err.message || 'Failed query');
        stage1Outputs[persona.id] = {
          personaId: persona.id,
          content,
          status: 'error',
          error: errorMsg,
        };
        dispatch({
          type: 'ERROR_STAGE1_PERSONA',
          payload: { roundId, personaId: persona.id, error: errorMsg },
        });
        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [persona.id]: { personaId: persona.id, content, status: 'error', error: errorMsg },
            },
          },
        }));
      }
    });

    await Promise.allSettled(stage1Promises);

    if (abortController.signal.aborted) return;

    if (mode === 'quick_panel' || activePersonas.length === 1) {
      try {
        const fullSynthText = await runSynthesisPhase(roundId, queryText, attachedImages, stage1Outputs, {}, abortController.signal);
        const roundWallClockMs = Date.now() - roundStartMs;
        await buildAndSaveAuditLog(
          roundId,
          queryText,
          activePresetId,
          mode,
          activePersonas,
          synthesizer,
          stage1Outputs,
          {},
          { content: fullSynthText || '', model: synthesizer.model || settings.defaultModels['synthesizer'] },
          roundWallClockMs,
          fallbackLogs,
          isProCompareEnabled,
          settings.apiKey,
          abortController.signal
        );
      } catch (err) {
        console.error('Error executing quick panel synthesis:', err);
      } finally {
        setIsDeliberating(false);
        abortControllerRef.current = null;
      }
      return;
    }

    // Check if Stop After Stage 1 setting is enabled
    if (settings.stopAfterStage1) {
      showToast("Option 'Stop after Stage 1' active — proceeding directly to synthesis.", 3000);
      try {
        const fullSynthText = await runSynthesisPhase(roundId, queryText, attachedImages, stage1Outputs, {}, abortController.signal);
        const roundWallClockMs = Date.now() - roundStartMs;
        await buildAndSaveAuditLog(
          roundId,
          queryText,
          activePresetId,
          mode,
          activePersonas,
          synthesizer,
          stage1Outputs,
          {},
          { content: fullSynthText || '', model: synthesizer.model || settings.defaultModels['synthesizer'] },
          roundWallClockMs,
          fallbackLogs,
          isProCompareEnabled,
          settings.apiKey,
          abortController.signal
        );
      } finally {
        setIsDeliberating(false);
        abortControllerRef.current = null;
      }
      return;
    }

    // Check cost ceiling after Stage 1
    if (settings.maxRoundCostCeiling && settings.maxRoundCostCeiling > 0) {
      const currentRoundCost = countRoundCost(
        { id: roundId, userQuery: queryText, timestamp: Date.now(), deliberation: { stage1: stage1Outputs } } as any
      ).totalCost;
      if (currentRoundCost >= settings.maxRoundCostCeiling) {
        showToast(`Cost ceiling (${settings.maxRoundCostCeiling.toFixed(2)}) reached after Stage 1. Running synthesis...`, 4000);
        try {
          const fullSynthText = await runSynthesisPhase(roundId, queryText, attachedImages, stage1Outputs, {}, abortController.signal);
          const roundWallClockMs = Date.now() - roundStartMs;
          await buildAndSaveAuditLog(
            roundId,
            queryText,
            activePresetId,
            mode,
            activePersonas,
            synthesizer,
            stage1Outputs,
            {},
            { content: fullSynthText || '', model: synthesizer.model || settings.defaultModels['synthesizer'] },
            roundWallClockMs,
            fallbackLogs,
            isProCompareEnabled,
            settings.apiKey,
            abortController.signal
          );
        } finally {
          setIsDeliberating(false);
          abortControllerRef.current = null;
        }
        return;
      }
    }

    // Stage 2: Deep Council Peer Review with Anonymized Inputs
    const activeStage2: Record<string, PersonaResponse> = {};
    activePersonas.forEach((p) => {
      activeStage2[p.id] = { personaId: p.id, content: '', status: 'streaming' };
    });

    dispatch({ type: 'START_STAGE2', payload: { roundId, initialStage2: activeStage2 } });
    updateRoundInActiveSession(roundId, (r) => ({
      ...r,
      deliberation: {
        ...r.deliberation,
        stage2: activeStage2,
      },
    }));

    const stage2Outputs: Record<string, PersonaResponse> = {};

    const stage2Promises = activePersonas.map(async (persona, idx) => {
      const peerProposals = activePersonas
        .map((p, pIdx) => {
          if (p.id === persona.id) return null;
          const resp = stage1Outputs[p.id];
          const letter = letters[pIdx] || `P${pIdx + 1}`;
          return `### Panelist ${letter} (${p.role}):\n${resp?.content || '[No proposal / Error]'}`;
        })
        .filter(Boolean)
        .join('\n\n');

      const queryContentStr = `User Question: "${queryText}"\n\n--- Initial Round 1 Proposals from Other Council Members (Anonymized) ---\n${peerProposals}\n\nTask: Peer review the proposals above. Point out unaddressed risks, test assumptions, highlight valuable ideas, and refine your position. Refer to other members as Panelist A, Panelist B, Panelist C, etc.`;

      const stage2Messages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
        { role: 'system', content: persona.systemPrompt },
      ];

      if (attachedImages && attachedImages.length > 0) {
        stage2Messages.push({
          role: 'user' as const,
          content: [
            { type: 'text', text: queryContentStr },
            ...attachedImages.map((img) => ({ type: 'image_url', image_url: { url: img.url } })),
          ] as any,
        });
      } else {
        stage2Messages.push({
          role: 'user' as const,
          content: queryContentStr as any,
        });
      }

      let content = '';
      let streamGroundingData2: any = undefined;

      try {
        const res = await streamPersonaWithFallback({
          personaId: persona.id,
          personaName: persona.name,
          roundId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-3.7-flash',
          messages: stage2Messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          webMode: settings.webMode || 'auto',
          enableWebGrounding: settings.webMode === 'always' || (settings.webMode !== 'off' && Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding)),
          query: queryText,
          signal: abortController.signal,
          disableFallback: Boolean(settings.disableFallback),
          activePersonas,
          synthesizer,
          rawModels: rawModelsCatalog,
          isFreeOnlyPreset: activePersonas.every((p) => (p.model || '').includes(':free')),
          onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
          onGrounding: (gData) => { streamGroundingData2 = gData; },
          onToken: (chunk) => {
            content += chunk;
            dispatch({
              type: 'UPDATE_STAGE2_TOKEN',
              payload: { roundId, personaId: persona.id, chunk },
            });

            const hasCodeArchive = Boolean(
              (attachedFiles && attachedFiles.some((f) => f.unzippedResult || f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.rar') || f.content?.includes('[CODEBASE FILE CONTENTS]'))) ||
              (activeSession?.attachedFiles && activeSession.attachedFiles.some((f) => f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.rar') || f.content?.includes('[CODEBASE FILE CONTENTS]'))) ||
              queryText.includes('[CODEBASE FILE CONTENTS]') ||
              queryText.includes('[CODEBASE FILE TREE]')
            );
            if (hasCodeArchive) {
              const refusalCheck = detectCodeCapabilityRefusal(content, true);
              if (refusalCheck.isRefusal) {
                console.warn(`[CapabilityGuard] Stage 2 Persona ${persona.name} refused code reading:`, refusalCheck.snippet);
                const executedModel2 = persona.model || settings.defaultModels[persona.id] || 'Unknown';
                const failure: CapabilityFailure = {
                  personaId: persona.id,
                  personaName: persona.name,
                  model: executedModel2,
                  stage: 2,
                  reason: 'Model reported inability to read code archive or inspect source files.',
                  detectedSnippet: refusalCheck.snippet,
                };
                abortController.abort();
                updateRoundInActiveSession(roundId, (r) => ({
                  ...r,
                  capabilityFailure: failure,
                }));
                showToast(`Deliberation halted: ${persona.name} (${executedModel2}) reported inability to read the codebase.`, 6000);
              }
            }
          },
        });

        const finalGrounding2 = res?.grounding || streamGroundingData2;
        const executedModel2 = res?.finalModel || persona.model || settings.defaultModels[persona.id];

        stage2Outputs[persona.id] = {
          personaId: persona.id,
          content: res.content || content,
          status: 'completed',
          grounding: finalGrounding2,
          model: executedModel2,
        };

        dispatch({
          type: 'FINISH_STAGE2_PERSONA',
          payload: { roundId, personaId: persona.id, content: res.content || content, grounding: finalGrounding2, model: executedModel2 },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [persona.id]: { personaId: persona.id, content: res.content || content, status: 'completed', grounding: finalGrounding2, model: executedModel2 },
            },
          },
        }));
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        const errorMsg = err.message || 'Failed Stage 2 peer review';
        stage2Outputs[persona.id] = {
          personaId: persona.id,
          content,
          status: 'error',
          error: errorMsg,
        };
        dispatch({
          type: 'ERROR_STAGE2_PERSONA',
          payload: { roundId, personaId: persona.id, error: errorMsg },
        });
        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [persona.id]: { personaId: persona.id, content, status: 'error', error: errorMsg },
            },
          },
        }));
      }
    });

    await Promise.allSettled(stage2Promises);

    if (abortController.signal.aborted) return;

    try {
      const fullSynthText = await runSynthesisPhase(roundId, queryText, attachedImages, stage1Outputs, stage2Outputs, abortController.signal);
      const roundWallClockMs = Date.now() - roundStartMs;
      await buildAndSaveAuditLog(
        roundId,
        queryText,
        activePresetId,
        mode,
        activePersonas,
        synthesizer,
        stage1Outputs,
        stage2Outputs,
        { content: fullSynthText || '', model: synthesizer.model || settings.defaultModels['synthesizer'] },
        roundWallClockMs,
        fallbackLogs,
        isProCompareEnabled,
        settings.apiKey,
        abortController.signal
      );
    } finally {
      releaseDeliberationLock();
      abortControllerRef.current = null;
    }
  };

  const runQuickPanelSynthesis = async (roundId: string) => {
    if (!acquireDeliberationLock()) return;
    const round = rounds.find((r) => r.id === roundId);
    if (!round) {
      releaseDeliberationLock();
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      dispatch({ type: 'START_SYNTHESIS', payload: { roundId } });
      updateRoundInActiveSession(roundId, (r) => ({
        ...r,
        synthesis: { content: '', status: 'streaming' },
      }));

      const stage1Map = round.deliberation?.stage1 || {};
      const validProposals = Object.values(stage1Map)
        .filter((resp: PersonaResponse | any) => resp?.status === 'completed' && resp?.content?.trim())
        .map((resp: PersonaResponse | any) => {
          const p = personas.find((item) => item.id === resp.personaId);
          return `### ${p?.name || resp.personaId} (${p?.role}):\n${resp.content}`;
        })
        .join('\n\n');

      const synthesisPrompt = `You are the Quick Panel Synthesizer. Review the independent answers below from panel members for the user query: "${round.userQuery}".

--- Panel Member Responses ---
${validProposals}

Task: Provide a concise, highly readable synthesis summarizing the key answers, highlighting consensus, and noting any conflicting advice.`;

      const messages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
        { role: 'system', content: synthesizer.systemPrompt || CHAIRMAN_PROMPT },
        { role: 'user', content: synthesisPrompt },
      ];

      let fullSynthesis = '';
      const executionPolicy = policyForPreset(activePresetId);
      const synthModel = synthesizer.model || settings.defaultModels['synthesizer'];
      if (!synthModel) {
        throw new Error('No model assigned for synthesis');
      }

      const res = await streamPersonaWithFallback({
        personaId: 'synthesizer',
        personaName: synthesizer.name,
        roundId,
        apiKey: settings.apiKey,
        model: synthModel,
        messages,
        temperature: 0.5,
        maxTokens: settings.synthesisMaxTokens || executionPolicy.maxOutputTokens || 500,
        signal: abortController.signal,
        disableFallback: Boolean(settings.disableFallback),
        activePersonas: personas.filter((p) => p.enabled !== false),
        synthesizer,
        rawModels: rawModelsCatalog,
        isFreeOnlyPreset: executionPolicy.budget === 'free',
        onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
        onToken: (chunk) => {
          fullSynthesis += chunk;
          dispatch({ type: 'UPDATE_SYNTHESIS_TOKEN', payload: { roundId, chunk } });
        },
      });

      const executedSynthModel = res?.finalModel || synthModel;

      dispatch({ type: 'FINISH_SYNTHESIS', payload: { roundId, model: executedSynthModel } });
      updateRoundInActiveSession(roundId, (r) => ({
        ...r,
        synthesis: { content: fullSynthesis, status: 'completed', model: executedSynthModel },
      }));
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      const errorMsg = err.message || 'Quick Panel Synthesis failed';
      dispatch({ type: 'ERROR_SYNTHESIS', payload: { roundId, error: errorMsg } });
      updateRoundInActiveSession(roundId, (r) => ({
        ...r,
        synthesis: { ...r.synthesis, status: 'error', error: errorMsg },
      }));
    } finally {
      releaseDeliberationLock();
      abortControllerRef.current = null;
    }
  };

  ;

  const reRunRoundDeliberation = async (roundId: string) => {
    if (deliberationLockRef.current || isDeliberating) return;
    const round = rounds.find((r) => r.id === roundId);
    if (!round) return;

    // Clear any previous capability failure on re-run
    updateRoundInActiveSession(roundId, (r) => ({
      ...r,
      capabilityFailure: undefined,
    }));

    const mode = round.resolvedMode || resolveExecutionMode(settings.executionMode || 'auto', round.userQuery);
    await runRoundExecution(round.id, round.userQuery, round.attachedImages, mode);
  };

  const handleUpgradeToCodingModels = async (roundId: string) => {
    if (isDeliberating) return;
    const { updatedPersonas, updatedSynthesizer } = upgradeToHighCapabilityCodingCouncil(personas, synthesizer);
    setPersonas(updatedPersonas);
    setSynthesizer(updatedSynthesizer);

    updateRoundInActiveSession(roundId, (r) => ({
      ...r,
      capabilityFailure: undefined,
    }));

    showToast('Upgraded council to Claude 3.7 Sonnet, DeepSeek V3 & Gemini Flash. Restarting deliberation...', 4000);
    await reRunRoundDeliberation(roundId);
  };

  const handleSwitchToGeminiFlash = async (roundId: string) => {
    if (isDeliberating) return;
    const updatedPersonas = personas.map((p) => ({
      ...p,
      model: 'google/gemini-3.7-flash',
    }));
    const updatedSynthesizer = {
      ...synthesizer,
      model: 'google/gemini-3.7-flash',
    };
    setPersonas(updatedPersonas);
    setSynthesizer(updatedSynthesizer);

    updateRoundInActiveSession(roundId, (r) => ({
      ...r,
      capabilityFailure: undefined,
    }));

    showToast('Switched all personas to Gemini 3.7 Flash (1M+ context). Restarting deliberation...', 4000);
    await reRunRoundDeliberation(roundId);
  };

  const handleDeliberate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!query.trim() && attachedFiles.length === 0) || isDeliberating || deliberationLockRef.current) return;

    setFileError(null);
    setCollapsedRoundIds(new Set(rounds.map(r => r.id)));

    const activePersonas = personas.filter((p) => p.enabled !== false);
    if (activePersonas.length === 0) {
      alert('Please enable at least one council member persona to start deliberation.');
      return;
    }

    if (attachedFiles.length > 0) {
      const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.svg', '.zip', '.rar', '.tar', '.gz', '.tgz', '.7z'];
      const unsupportedFiles = attachedFiles.filter(f => !allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) && !f.type?.startsWith('image/'));
      
      if (unsupportedFiles.length > 0) {
        setFileError(`Unsupported file format(s): ${unsupportedFiles.map(f => f.name).join(', ')}. Allowed: ${allowedExtensions.join(', ')}`);
        return;
      }
    }

    const textFiles = attachedFiles.filter(f => !f.type?.startsWith('image/'));
    const imageFiles = attachedFiles.filter(f => f.type?.startsWith('image/')).map(f => ({ name: f.name, url: f.content, type: f.type }));

    const cleanUserQuery = query.trim();
    let queryTextForLLM = cleanUserQuery;
    
    const structuredAttachedTextFiles = textFiles.map((f) => ({
      name: f.name,
      type: f.type || 'text/plain',
      size: f.size,
      content: f.content,
      summary: f.unzippedResult
        ? `${f.unzippedResult.extractedCodeFilesCount} code files extracted (${Math.round(f.size / 1024)} KB)`
        : `${Math.round(f.content.length / 1000)}k chars (${Math.round(f.size / 1024)} KB)`,
    }));

    if (textFiles.length > 0) {
      const fileText = textFiles
        .map((f) => `--- Attached File: ${f.name} ---\n${f.content}`)
        .join('\n\n');
      queryTextForLLM = cleanUserQuery ? `User Question:\n${cleanUserQuery}\n\n${fileText}` : fileText;
    }

    const displayUserQuery = cleanUserQuery || (textFiles.length > 0 ? `Review attached file context (${textFiles.map(f => f.name).join(', ')})` : 'Untitled Deliberation');

    setQuery('');
    if (structuredAttachedTextFiles.length > 0) {
      updateActiveSessionFiles(structuredAttachedTextFiles);
    }
    setIsDeliberating(true);

    const mode = resolveExecutionMode(settings.executionMode || 'auto', queryTextForLLM, textFiles);
    const roundId = `round-${Date.now()}`;

    let targetPersonas = activePersonas;
    if (settings.useSingleModelForSimple && mode === 'quick_panel' && activePersonas.length > 1) {
      targetPersonas = [activePersonas[0]];
      showToast(`'Use single model for simple questions' active — routing query to ${targetPersonas[0].name} (${targetPersonas[0].model})`, 3000);
    }

    const initialStage1: Record<string, PersonaResponse> = {};
    const initialStage2: Record<string, PersonaResponse> = {};
    targetPersonas.forEach((p) => {
      initialStage1[p.id] = { personaId: p.id, content: '', status: 'streaming' };
      initialStage2[p.id] = { personaId: p.id, content: '', status: 'idle' };
    });

    const isCurrentRoundIsolated = isIsolatedRound;

    const newRound: CouncilRound = {
      id: roundId,
      userQuery: displayUserQuery,
      timestamp: Date.now(),
      resolvedMode: mode,
      isIsolatedRound: isCurrentRoundIsolated,
      deliberation: {
        stage1: initialStage1,
        stage2: initialStage2,
      },
      synthesis: { content: '', status: 'idle' },
      attachedImages: imageFiles.length > 0 ? imageFiles : undefined,
      attachedTextFiles: structuredAttachedTextFiles.length > 0 ? structuredAttachedTextFiles : undefined,
    };

    dispatch({ type: 'ADD_ROUND', payload: newRound });
    addRoundToActiveSession(newRound);

    await runRoundExecution(roundId, queryTextForLLM, imageFiles.length > 0 ? imageFiles : undefined, mode, isCurrentRoundIsolated);
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 dark:text-slate-200 font-sans antialiased overflow-hidden selection:bg-cyan-500/20 selection:text-cyan-200 relative">
      {/* Skip to Main Content Link for Keyboard / Screen Reader Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[150] focus:px-4 focus:py-2.5 focus:bg-indigo-600 focus:text-white focus:font-semibold focus:rounded-xl focus:shadow-2xl focus:outline-hidden focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>

      {/* Live Region for Screen Readers */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isDeliberating ? 'Council deliberation is in progress.' : ''}
      </div>

      {/* Sidebar for Deliberation Threads */}
      <CouncilSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        filteredSessions={filteredSessions}
        activeSessionId={activeSessionId}
        activeSession={activeSession}
        sessionSearchQuery={sessionSearchQuery}
        setSessionSearchQuery={setSessionSearchQuery}
        onCreateNewSession={createNewSession}
        onSelectSession={selectSession}
        onDeleteSession={deleteSession}
        onClearAllSessions={clearAllSessions}
        onClearActiveHistory={handleClearActiveHistory}
        isDeliberating={isDeliberating}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto relative" onScroll={handleMainScroll}>
        {/* Header */}
        <CouncilHeader
          isSidebarOpen={isSidebarOpen}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          sessionsCount={sessions.length}
          sessionCostMetrics={sessionCostMetrics}
          formatCost={formatCost}
          basicMode={basicMode}
          onToggleBasicMode={toggleBasicMode}
          theme={theme}
          onSetTheme={setTheme}
          onOpenAuditModal={() => setIsAuditModalOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          user={user}
          onLogin={handleGoogleLogin}
          onLogout={handleGoogleLogout}
          onCreateNewSession={createNewSession}
          isDeliberating={isDeliberating}
        />

      {/* Main Content Feed */}
      <main id="main-content" tabIndex={-1} aria-label="Council Deliberation Feed" className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 space-y-6 pb-32 focus:outline-hidden">
        <CouncilSummaryBar
          presetId={activePresetId}
          onOpenSettings={() => setIsSettingsOpen(true)}
          answerMode={settings.executionMode || 'auto'}
          taskDomain={activeAppliedDomain || undefined}
          personas={personas}
          synthesizer={synthesizer}
          rawModels={rawModelsCatalog}
          updatedAt={recommendationMetadata?.updatedAt}
        />
        {(() => {
          if (basicMode) return null;
          const activePersonas = personas.filter((p) => p.enabled !== false);
          const firstIncomplete = rounds.find((r) => getRoundIncompleteStage(r, activePersonas).isIncomplete);
          if (!firstIncomplete) return null;

          const info = getRoundIncompleteStage(firstIncomplete, activePersonas);
          const roundIdx = rounds.findIndex((r) => r.id === firstIncomplete.id) + 1;

          return (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 flex flex-wrap items-center justify-between gap-3 text-amber-200 text-xs shadow-md">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="font-semibold text-amber-100">Interrupted Deliberation Detected:</span>
                <span className="text-amber-300/90 font-mono">Round {roundIdx} • {info.description}</span>
              </div>
              <button
                onClick={() => resumeIncompleteRound(firstIncomplete.id)}
                disabled={isDeliberating}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                <Play size={12} className={isDeliberating ? 'animate-spin' : 'fill-current'} />
                <span>Resume Round {roundIdx}</span>
              </button>
            </div>
          );
        })()}

        {rounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-cyan-400 shadow-xl">
              <Sparkles size={32} />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200">Convened for Deliberation</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Submit any question or complex decision. A council of distinct AI personas will analyze it across 3 structured stages to build synthesis and consensus.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {rounds.length > 1 && (
              <div className="flex justify-center -mb-2">
                <button
                  onClick={() => {
                    if (collapsedRoundIds.size > 0) {
                      setCollapsedRoundIds(new Set());
                    } else {
                      setCollapsedRoundIds(new Set(rounds.slice(0, -1).map(r => r.id)));
                    }
                  }}
                  className="text-xs font-mono text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white dark:bg-slate-900/50 hover:bg-slate-100/80 border border-slate-200 dark:border-slate-700"
                >
                  {collapsedRoundIds.size > 0 ? (
                    <><ChevronDown size={14} /> Show All History</>
                  ) : (
                    <><ChevronUp size={14} /> Hide Past Rounds</>
                  )}
                </button>
              </div>
            )}
            {rounds.map((round, idx) => (
              <CouncilRoundView
                key={round.id}
                round={round}
                index={idx}
                personas={personas}
                synthesizer={synthesizer}
                isDeliberating={isDeliberating}
                basicMode={basicMode}
                speakingId={speakingId}
                copiedId={copiedId}
                settings={settings}
                onDeleteRound={handleDeleteRound}
                onRegeneratePersona={handleRegeneratePersona}
                onResynthesize={runQuickPanelSynthesis}
                onSpeak={speak}
                onCopy={(id, text) => {
                  navigator.clipboard.writeText(text);
                  setCopiedId(id);
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                onSaveRating={handleRateRound}
                isCollapsed={collapsedRoundIds.has(round.id)}
                onToggleCollapse={toggleRoundCollapse}
                onReRunRound={reRunRoundDeliberation}
                onEditPrompt={handleEditPrompt}
                onResumeRound={resumeIncompleteRound}
                onUpgradeAndReRun={handleUpgradeToCodingModels}
                onSwitchToGeminiFlash={handleSwitchToGeminiFlash}
                onOpenSettings={() => setIsSettingsOpen(true)}
                incompleteStage={(() => {
                  const activePersonas = personas.filter((p) => p.enabled !== false);
                  return getRoundIncompleteStage(round, activePersonas);
                })()}
              />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} className="h-4" />
      </main>

      {/* Floating Scroll to Bottom Arrow Button */}
      {showScrollBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="fixed bottom-40 right-5 sm:right-8 z-50 p-3 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-xl shadow-cyan-950/60 transition-all transform hover:scale-110 active:scale-95 border border-cyan-400/40 flex items-center justify-center group"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={18} className="group-hover:translate-y-0.5 transition-transform" />
        </button>
      )}

      {/* Composer Component */}
      <Composer
        query={query}
        setQuery={setQuery}
        attachedFiles={attachedFiles}
        fileError={fileError}
        setFileError={setFileError}
        isDeliberating={isDeliberating}
        handleDeliberate={handleDeliberate}
        handleStop={handleStop}
        removeAttachedFile={handleRemoveAttachedFile}
        fileInputRef={fileInputRef}
        handleFileUpload={handleFileUpload}
        handleDrop={handleDrop}
        handleDragOver={handleDragOver}
        handlePaste={handlePaste}
        queryTokens={queryTokens}
        estimatedQueryTokens={estimatedQueryTokens}
        estimatedQueryCost={estimatedQueryCost}
        sessionCostMetrics={sessionCostMetrics}
        basicMode={basicMode}
        selectedTaskDomain={selectedTaskDomain}
        handleApplySmartDomainModelSelection={handleApplySmartDomainModelSelection}
        activeAppliedDomain={activeAppliedDomain}
        selectionDebugResult={selectionDebugResult}
        autoSelectModels={autoSelectModels}
        handleToggleAutoSelectModels={handleToggleAutoSelectModels}
        personas={personas}
        setPersonas={setPersonas}
        setSynthesizer={setSynthesizer}
        executionMode={settings.executionMode || 'auto'}
        updateExecutionMode={updateExecutionMode}
        rotateRoleAssignments={rotateRoleAssignments}
        fallbackLogs={fallbackLogs}
        setIsFallbackModalOpen={setIsFallbackModalOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        setActiveZipResult={setActiveZipResult}
        setIsZipModalOpen={setIsZipModalOpen}
        hasPreviousRounds={rounds.length > 0}
        isIsolatedRound={isIsolatedRound}
        setIsIsolatedRound={setIsIsolatedRound}
        onStartNewSession={() => {
          createNewSession();
          showToast('Started new deliberation thread');
        }}
        stopAfterStage1={settings.stopAfterStage1}
        setStopAfterStage1={updateStopAfterStage1}
        useSingleModelForSimple={settings.useSingleModelForSimple}
        setUseSingleModelForSimple={updateUseSingleModelForSimple}
        maxRoundCostCeiling={settings.maxRoundCostCeiling}
        enableSearchGrounding={!!settings.enableSearchGrounding}
        onToggleSearchGrounding={() => updateEnableSearchGrounding(!settings.enableSearchGrounding)}
        webMode={settings.webMode || 'auto'}
        onUpdateWebMode={updateWebMode}
      />

      {/* Settings Modal */}
      <SettingsPanel
        isProCompareEnabled={isProCompareEnabled}
        handleToggleProCompare={handleToggleProCompare}
        setIsAuditModalOpen={setIsAuditModalOpen}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        personas={personas}
        setPersonas={setPersonas}
        synthesizer={synthesizer}
        setSynthesizer={setSynthesizer}
        theme={theme}
        setTheme={setTheme}
        maxTokens={settings.maxTokens}
        setMaxTokens={updateMaxTokens}
        executionMode={settings.executionMode}
        setExecutionMode={updateExecutionMode}
        quickPanelMaxTokens={settings.quickPanelMaxTokens}
        setQuickPanelMaxTokens={updateQuickPanelMaxTokens}
        synthesisMaxTokens={settings.synthesisMaxTokens}
        setSynthesisMaxTokens={updateSynthesisMaxTokens}
        panelTimeoutSeconds={settings.panelTimeoutSeconds}
        setPanelTimeoutSeconds={updatePanelTimeoutSeconds}
        enableSearchGrounding={settings.enableSearchGrounding}
        setEnableSearchGrounding={updateEnableSearchGrounding}
        webMode={settings.webMode || 'auto'}
        setWebMode={updateWebMode}
        onRefreshModels={handleRefreshModels}
        activePresetId={activePresetId}
        setActivePresetId={setActivePresetId}
        onApplyPreset={handleApplyPreset}
        rawModelsCatalog={rawModelsCatalog}
        availableModels={availableModels}
        recommendationMetadata={recommendationMetadata}
        isRefreshing={isRefreshing}
        isDebounced={isDebounced}
        presetWarnings={presetWarnings}
        selectedTaskDomain={selectedTaskDomain}
        autoSelectModels={autoSelectModels}
        setAutoSelectModels={handleToggleAutoSelectModels}
        maxRoundCostCeiling={settings.maxRoundCostCeiling}
        setMaxRoundCostCeiling={updateMaxRoundCostCeiling}
        stopAfterStage1={settings.stopAfterStage1}
        setStopAfterStage1={updateStopAfterStage1}
        useSingleModelForSimple={settings.useSingleModelForSimple}
        setUseSingleModelForSimple={updateUseSingleModelForSimple}
        archivistRecentRounds={settings.archivistRecentRounds ?? 2}
        setArchivistRecentRounds={updateArchivistRecentRounds}
        proCompareModelId={settings.proCompareModelId || 'anthropic/claude-3.7-sonnet'}
        setProCompareModelId={updateProCompareModelId}
        disableFallback={settings.disableFallback}
        setDisableFallback={updateDisableFallback}
        disableLoadingOverlay={settings.disableLoadingOverlay}
        setDisableLoadingOverlay={updateDisableLoadingOverlay}
        notificationPreferences={settings.notificationPreferences}
        onUpdateNotifications={updateNotificationPreferences}
        onExportSessions={exportSessionsJSON}
        onImportSessions={handleImportSessionsFile}
        sessionsCount={sessions.length}
      />

      {/* Fallback Audit Modal */}
      <FallbackAuditModal
        isOpen={isFallbackModalOpen}
        onClose={() => setIsFallbackModalOpen(false)}
        logs={fallbackLogs}
        onClearLogs={() => setFallbackLogs([])}
      />

      {/* Request Telemetry & Audit Log Modal */}
      <AuditLogModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
      />

      {/* Zip Code Reader Files Modal */}
      <ZipFilesModal
        zipResult={activeZipResult}
        isOpen={isZipModalOpen}
        onClose={() => setIsZipModalOpen(false)}
      />

      {/* Unified Accessible Toast Notifications */}
      <UnifiedToast toasts={toasts} onDismiss={dismissToast} />

      {/* Global Busy Overlay (Optional, user can dismiss or permanently opt out) */}
      {isDeliberating && !settings.disableLoadingOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-xs pointer-events-auto">
          <div className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl text-slate-200 text-sm font-semibold max-w-xs text-center">
            <div className="flex items-center gap-2.5 text-cyan-400">
              <Loader2 size={20} className="animate-spin text-cyan-400" />
              <span>Council Deliberating...</span>
            </div>
            <p className="text-xs text-slate-400 font-normal">
              Stage execution in progress. You can watch live in feed or dismiss this overlay.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => updateDisableLoadingOverlay(true)}
                className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
                title="Never show this loading overlay again (can re-enable in Settings > Advanced)"
              >
                Don't show again
              </button>
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={() => updateDisableLoadingOverlay(true)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>

              
  );
};
