import React, { useState, useRef, useEffect } from 'react';
import { Persona, CouncilRound, Settings, PersonaResponse } from '../types';
import { INITIAL_PERSONAS, CHAIRMAN_PROMPT, defaultSynthesizer } from '../data';
import { MessageMarkdown } from './MessageMarkdown';
import { SettingsPanel } from './SettingsPanel';
import { useSessionManager } from '../hooks/useSessionManager';
import { useCouncilReducer } from '../hooks/useCouncilReducer';
import { usePersonaStream } from '../hooks/usePersonaStream';
import { useModelRecommendations } from '../hooks/useModelRecommendations';
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
import { SynthesizeConsensusPanel } from './SynthesizeConsensusPanel';
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
import {
  streamPersonaWithFallback,
  getStoredFallbackEvents,
  FallbackEvent,
  computeOrderedBackupList,
} from '../lib/fallbackManager';
import { GroundingSourcesCard } from './GroundingSourcesCard';
import { HeaderActions } from './HeaderActions';
import { Composer } from './Composer';
import { CouncilRoundView } from './CouncilRoundView';
import { SynthesisCard } from './SynthesisCard';
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
          <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono truncate max-w-[140px]">
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
        <span className="truncate">{personaName} {role ? `(${role})` : ''} is formulating analysis...</span>
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

      const defaultModels = savedModels
        ? JSON.parse(savedModels)
        : {
            skeptic: 'google/gemini-2.5-flash',
            visionary: 'anthropic/claude-3.5-haiku',
            pragmatist: 'openai/gpt-4o-mini',
            synthesizer: 'google/gemini-2.5-flash',
          };
      return {
        apiKey: savedKey,
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
      };
    } catch {
      return {
        apiKey:  '',
        defaultModels: {
          skeptic: 'google/gemini-2.5-flash',
          visionary: 'anthropic/claude-3.5-haiku',
          pragmatist: 'openai/gpt-4o-mini',
          synthesizer: 'google/gemini-2.5-flash',
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
      };
    }
  });

  const settings = propsSettings || internalSettings;

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
    deleteRoundFromActiveSession,
    exportSessionsJSON,
    importSessionsJSON,
  } = useSessionManager();

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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (msg: string, duration = 3500) => {
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), duration);
  };
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

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

  // File Upload State
  interface AttachedFile {
    name: string;
    content: string;
    size: number;
    type: string;
    unzippedResult?: ZipArchiveResult;
  }
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [activeZipResult, setActiveZipResult] = useState<ZipArchiveResult | null>(null);
  const [isZipModalOpen, setIsZipModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Theme Preference State
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('council-theme') as 'dark' | 'light' | 'system') || 'light';
  });

  useEffect(() => {
    localStorage.setItem('council-theme', theme);
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else if (theme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.remove('dark');
        root.classList.add('light');
      }
    }
  }, [theme]);

  const processFiles = async (files: FileList | File[] | DataTransferItemList) => {
    if (!files || files.length === 0) return;
    setFileError(null);

    const fileList: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item instanceof DataTransferItem) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) fileList.push(file);
        }
      } else {
        fileList.push(item);
      }
    }

    const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.svg', '.zip'];
    const allowedMimeTypes = ['text/', 'application/json', 'application/pdf', 'image/', 'application/zip', 'application/x-zip-compressed', 'application/zip-compressed'];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const isImage = file.type.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif|svg|heic)$/i.test(file.name);
      const isAllowed = isImage ||
                        allowedMimeTypes.some(m => file.type.startsWith(m)) || 
                        allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

      if (!isAllowed) {
        setFileError(`Unsupported file format: ${file.name}. Only code, text, PDF, ZIP archives, and images are supported.`);
        continue;
      }

      if (file.size > 30 * 1024 * 1024) {
        setFileError(`File too large: ${file.name}. Maximum size is 30MB.`);
        continue;
      }

      if (file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')) {
        try {
          const zipResult = await extractCodeFromZip(file);
          if (zipResult.extractedCodeFilesCount === 0) {
            setFileError(`Zip archive ${file.name} contained no readable code or text files.`);
            continue;
          }
          setAttachedFiles((prev) => [
            ...prev,
            {
              name: file.name,
              content: zipResult.formattedContext,
              size: file.size,
              type: 'application/zip',
              unzippedResult: zipResult,
            },
          ]);
          if (zipResult.wasTruncated) {
            showToast(`📦 Extracted ${zipResult.extractedCodeFilesCount} files from ${file.name} (capped by guardrails)`);
          } else {
            showToast(`📦 Extracted ${zipResult.extractedCodeFilesCount} code files from ${file.name}`);
          }
        } catch (error) {
          console.error("Error reading zip archive:", error);
          setFileError(`Could not read code from zip file: ${file.name}`);
        }
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          let text = await extractTextFromPDF(file);
          if (text.length > 150_000) {
            text = text.slice(0, 150_000) + '\n\n... [PDF TRUNCATED AFTER 150,000 CHARS]';
            showToast(`⚠️ PDF ${file.name} truncated to 150,000 characters.`);
          }
          setAttachedFiles((prev) => [
            ...prev,
            { name: file.name, content: text, size: file.size, type: 'application/pdf' },
          ]);
        } catch (error) {
          console.error("Error reading PDF:", error);
          setFileError(`Could not read text from PDF: ${file.name}`);
        }
      } else if (isImage) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target && typeof event.target.result === 'string') {
            setAttachedFiles((prev) => [
              ...prev,
              { name: file.name, content: event.target!.result as string, size: file.size, type: file.type || 'image/jpeg' },
            ]);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result;
          if (typeof result === 'string') {
            let text = result;
            if (text.length > 150_000) {
              text = text.slice(0, 150_000) + '\n\n... [FILE TRUNCATED AFTER 150,000 CHARS]';
              showToast(`⚠️ File ${file.name} truncated to 150,000 characters.`);
            }
            setAttachedFiles((prev) => [
              ...prev,
              { name: file.name, content: text, size: file.size, type: file.type || 'text/plain' },
            ]);
          }
        };
        reader.readAsText(file);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData && e.clipboardData.items) {
      const items = e.clipboardData.items;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        await processFiles(files);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer && e.dataTransfer.items) {
      await processFiles(e.dataTransfer.items);
    } else if (e.dataTransfer && e.dataTransfer.files) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

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
      synthesizer: synthesizer.model || 'google/gemini-2.5-flash'
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
  }, [personas, synthesizer]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [collapsedRoundIds, setCollapsedRoundIds] = useState<Set<string>>(new Set());
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileError) return;
    const t = window.setTimeout(() => setFileError(null), 6000);
    return () => window.clearTimeout(t);
  }, [fileError]);

  const queryTokens = estimateTokens(query);

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

  const updateApiKey = (key: string) => {
    const updated = { ...settings, apiKey: key };
    setInternalSettings(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
    localStorage.setItem('openrouter_api_key', key);
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
      console.log(`[Synthesis Phase] Initiating stream with model: ${synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.5-flash'}`);
      console.log(`[Synthesis Phase] Messages payload length: ${JSON.stringify(chairmanMessages).length} chars`);
      
      let streamGroundingData: any = undefined;

      const streamPromise = streamPersona({
        personaId: 'synthesizer',
        apiKey: settings.apiKey,
        model: synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.5-flash',
        messages: chairmanMessages,
        temperature: 0.5,
        maxTokens: Math.min(Math.max((settings.maxTokens || 4000) * 2, 8000), 8192),
        enableSearchGrounding: Boolean(settings.enableSearchGrounding || synthesizer.enableSearchGrounding),
        signal,
        onGrounding: (gData) => { streamGroundingData = gData; },
        onToken: (chunk) => {
          if (!fullSynthesis) {
            console.log(`[Synthesis Phase] First token received for round ${targetRoundId}`);
          }
          fullSynthesis += chunk;
          dispatch({ type: 'UPDATE_SYNTHESIS_TOKEN', payload: { roundId: targetRoundId, chunk } });
          updateRoundInActiveSession(targetRoundId, (r) => ({
            ...r,
            synthesis: {
              ...r.synthesis,
              content: (r.synthesis?.content || '') + chunk,
            },
          }));
        },
      });

      console.log(`[Synthesis Phase] Awaiting stream completion for round ${targetRoundId}...`);
      const synthRes = await streamPromise;
      console.log(`[Synthesis Phase] Stream completed successfully. Total length: ${fullSynthesis.length} characters.`);

      const finalSynthGrounding = synthRes?.grounding || streamGroundingData;
      const executedSynthModel = synthRes?.finalModel || synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.5-flash';

      dispatch({ type: 'FINISH_SYNTHESIS', payload: { roundId: targetRoundId, grounding: finalSynthGrounding, model: executedSynthModel } });
      updateRoundInActiveSession(targetRoundId, (r) => ({
        ...r,
        synthesis: { ...r.synthesis, content: fullSynthesis, status: 'completed', grounding: finalSynthGrounding, model: executedSynthModel },
      }));
      console.log(`[Synthesis Phase] Finished successfully for round ${targetRoundId}`);
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
      const selectedModelId = p.model || settings.defaultModels[p.id] || 'google/gemini-2.5-flash';
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
        ...(fallbackForPersona ? { fallbackEvent: { reason: fallbackForPersona.triggerReason, replacementModel: fallbackForPersona.replacementModel } } : {}),
      });
    });

    // Synthesizer Audit
    const synthSelectedModel = synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.5-flash';
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
        const proModelId = 'anthropic/claude-3.7-sonnet';
        const proStart = Date.now();
        const proRes = await streamOpenRouterCompletion({
          apiKey,
          model: proModelId,
          messages: [
            { role: 'system', content: 'You are an elite, world-class AI model providing an exceptionally thorough, precise, and well-reasoned response to the user query.' },
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
          proModelOrg: 'Anthropic',
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
        replacementModel: f.replacementModel,
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
    if (isDeliberating) return;

    const round = rounds.find((r) => r.id === roundId);
    if (!round) return;

    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return;

    setIsDeliberating(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
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
        });

        let fullContent = '';
        let streamGroundingData: any = undefined;

        const res1 = await streamPersona({
          personaId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[personaId] || 'google/gemini-2.5-flash',
          messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          signal: abortController.signal,
          onGrounding: (gData) => { streamGroundingData = gData; },
          onToken: (chunk) => {
            fullContent += chunk;
            dispatch({
              type: 'UPDATE_STAGE1_TOKEN',
              payload: { roundId, personaId, chunk },
            });
            updateRoundInActiveSession(roundId, (r) => ({
              ...r,
              deliberation: {
                ...r.deliberation,
                stage1: {
                  ...r.deliberation?.stage1,
                  [personaId]: {
                    personaId,
                    content: (r.deliberation?.stage1?.[personaId]?.content || '') + chunk,
                    status: 'streaming',
                  },
                },
              },
            }));
          },
        });

        const finalGrounding1 = res1?.grounding || streamGroundingData;
        const executedModel1 = res1?.finalModel || persona.model || settings.defaultModels[personaId];

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

        const res2 = await streamPersona({
          personaId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[personaId] || 'google/gemini-2.5-flash',
          messages: stage2Messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          signal: abortController.signal,
          onGrounding: (gData) => { streamGroundingData2 = gData; },
          onToken: (chunk) => {
            fullContent += chunk;
            dispatch({
              type: 'UPDATE_STAGE2_TOKEN',
              payload: { roundId, personaId, chunk },
            });
            updateRoundInActiveSession(roundId, (r) => ({
              ...r,
              deliberation: {
                ...r.deliberation,
                stage2: {
                  ...r.deliberation?.stage2,
                  [personaId]: {
                    personaId,
                    content: (r.deliberation?.stage2?.[personaId]?.content || '') + chunk,
                    status: 'streaming',
                  },
                },
              },
            }));
          },
        });

        const finalGrounding2 = res2?.grounding || streamGroundingData2;
        const executedModel2 = res2?.finalModel || persona.model || settings.defaultModels[personaId];

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
      setIsDeliberating(false);
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
    if (isDeliberating) return;

    const round = rounds.find((r) => r.id === roundId);
    if (!round) return;

    const activePersonas = personas.filter((p) => p.enabled !== false);
    if (activePersonas.length === 0) {
      alert('Please enable at least one council member persona to start deliberation.');
      return;
    }

    const { isIncomplete, stage: startStage } = getRoundIncompleteStage(round, activePersonas);
    if (!isIncomplete) return;

    setIsDeliberating(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const stage1Map: Record<string, PersonaResponse> = { ...(round.deliberation?.stage1 || {}) };
    const stage2Map: Record<string, PersonaResponse> = { ...(round.deliberation?.stage2 || {}) };

    try {
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
          const messages = await buildArchivistContext({
            systemPrompt: persona.systemPrompt,
            userQuery: round.userQuery,
            attachedImages: round.attachedImages,
            rounds: rounds.filter((r) => r.id !== roundId),
            apiKey: settings.apiKey,
            signal: abortController.signal,
          });

          let content = '';
          try {
            const res1 = await streamPersona({
              personaId: persona.id,
              apiKey: settings.apiKey,
              model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.5-flash',
              messages,
              temperature: settings.temperature,
              maxTokens: settings.maxTokens,
              signal: abortController.signal,
              onToken: (chunk) => {
                content += chunk;
                dispatch({ type: 'UPDATE_STAGE1_TOKEN', payload: { roundId, personaId: persona.id, chunk } });
                updateRoundInActiveSession(roundId, (r) => {
                  const existing = r.deliberation?.stage1?.[persona.id];
                  return {
                    ...r,
                    deliberation: {
                      ...r.deliberation,
                      stage1: {
                        ...r.deliberation?.stage1,
                        [persona.id]: { ...existing, content: (existing?.content || '') + chunk, status: 'streaming' },
                      },
                    },
                  };
                });
              },
            });

            const executedModel1 = res1?.finalModel || persona.model || settings.defaultModels[persona.id];
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
              const res2 = await streamPersona({
                personaId: persona.id,
                apiKey: settings.apiKey,
                model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.5-flash',
                messages: stage2Messages,
                temperature: settings.temperature,
                maxTokens: settings.maxTokens,
                signal: abortController.signal,
                onToken: (chunk) => {
                  content += chunk;
                  dispatch({ type: 'UPDATE_STAGE2_TOKEN', payload: { roundId, personaId: persona.id, chunk } });
                  updateRoundInActiveSession(roundId, (r) => {
                    const existing = r.deliberation?.stage2?.[persona.id];
                    return {
                      ...r,
                      deliberation: {
                        ...r.deliberation,
                        stage2: {
                          ...r.deliberation?.stage2,
                          [persona.id]: { ...existing, content: (existing?.content || '') + chunk, status: 'streaming' },
                        },
                      },
                    };
                  });
                },
              });

              const executedModel2 = res2?.finalModel || persona.model || settings.defaultModels[persona.id];
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
      setIsDeliberating(false);
      abortControllerRef.current = null;
    }
  };

  const runRoundExecution = async (
    roundId: string,
    queryText: string,
    attachedImages: { name: string; url: string; type: string }[] | undefined,
    mode: ResolvedExecutionMode
  ) => {
    const roundStartMs = Date.now();
    setIsDeliberating(true);
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

      const messages = await buildArchivistContext({
        systemPrompt: persona.systemPrompt,
        userQuery: queryText,
        attachedImages,
        rounds: rounds.filter((r) => r.id !== roundId),
        apiKey: settings.apiKey,
        signal: perCallSignal,
      });

      let content = '';
      let streamGroundingData: any = undefined;

      try {
        const res = await streamPersonaWithFallback({
          personaId: persona.id,
          personaName: persona.name,
          roundId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.5-flash',
          messages,
          temperature: settings.temperature,
          maxTokens: mode === 'quick_panel' ? (settings.quickPanelMaxTokens || 350) : settings.maxTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          signal: perCallSignal,
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
            updateRoundInActiveSession(roundId, (r) => {
              const existing = r.deliberation?.stage1?.[persona.id];
              return {
                ...r,
                deliberation: {
                  ...r.deliberation,
                  stage1: {
                    ...r.deliberation?.stage1,
                    [persona.id]: {
                      ...existing,
                      content: (existing?.content || '') + chunk,
                      status: 'streaming',
                    },
                  },
                },
              };
            });
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
      setIsDeliberating(false);
      abortControllerRef.current = null;
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
          model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.5-flash',
          messages: stage2Messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          enableSearchGrounding: Boolean(settings.enableSearchGrounding || persona.enableSearchGrounding),
          signal: abortController.signal,
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
            updateRoundInActiveSession(roundId, (r) => ({
              ...r,
              deliberation: {
                ...r.deliberation,
                stage2: {
                  ...r.deliberation?.stage2,
                  [persona.id]: {
                    personaId: persona.id,
                    content: (r.deliberation?.stage2?.[persona.id]?.content || '') + chunk,
                    status: 'streaming',
                  },
                },
              },
            }));
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
      setIsDeliberating(false);
      abortControllerRef.current = null;
    }
  };

  const runQuickPanelSynthesis = async (roundId: string) => {
    if (isDeliberating) return;
    const round = rounds.find((r) => r.id === roundId);
    if (!round) return;

    setIsDeliberating(true);
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
      const synthModel = synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.5-flash';

      const res = await streamPersona({
        personaId: 'synthesizer',
        apiKey: settings.apiKey,
        model: synthModel,
        messages,
        temperature: 0.5,
        maxTokens: settings.synthesisMaxTokens || 500,
        signal: abortController.signal,
        onToken: (chunk) => {
          fullSynthesis += chunk;
          dispatch({ type: 'UPDATE_SYNTHESIS_TOKEN', payload: { roundId, chunk } });
          updateRoundInActiveSession(roundId, (r) => ({
            ...r,
            synthesis: {
              ...r.synthesis,
              content: (r.synthesis?.content || '') + chunk,
              status: 'streaming',
            },
          }));
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
      setIsDeliberating(false);
      abortControllerRef.current = null;
    }
  };

  ;

  const reRunRoundDeliberation = async (roundId: string) => {
    if (isDeliberating) return;
    const round = rounds.find((r) => r.id === roundId);
    if (!round) return;

    const mode = round.resolvedMode || resolveExecutionMode(settings.executionMode || 'auto', round.userQuery);
    await runRoundExecution(round.id, round.userQuery, round.attachedImages, mode);
  };

  const handleDeliberate = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!query.trim() && attachedFiles.length === 0) || isDeliberating) return;

    setFileError(null);
    setCollapsedRoundIds(new Set(rounds.map(r => r.id)));

    const activePersonas = personas.filter((p) => p.enabled !== false);
    if (activePersonas.length === 0) {
      alert('Please enable at least one council member persona to start deliberation.');
      return;
    }

    if (attachedFiles.length > 0) {
      const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.svg', '.zip'];
      const unsupportedFiles = attachedFiles.filter(f => !allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) && !f.type?.startsWith('image/'));
      
      if (unsupportedFiles.length > 0) {
        setFileError(`Unsupported file format(s): ${unsupportedFiles.map(f => f.name).join(', ')}. Allowed: ${allowedExtensions.join(', ')}`);
        return;
      }
    }

    const textFiles = attachedFiles.filter(f => !f.type?.startsWith('image/'));
    const imageFiles = attachedFiles.filter(f => f.type?.startsWith('image/')).map(f => ({ name: f.name, url: f.content, type: f.type }));

    let currentQuery = query.trim();
    if (textFiles.length > 0) {
      const fileText = textFiles
        .map((f) => `--- Attached File: ${f.name} ---\n${f.content}`)
        .join('\n\n');
      currentQuery = currentQuery ? `${fileText}\n\nUser Question:\n${currentQuery}` : fileText;
    }

    setQuery('');
    setAttachedFiles([]);
    setIsDeliberating(true);

    const mode = resolveExecutionMode(settings.executionMode || 'auto', currentQuery, textFiles);
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

    const newRound: CouncilRound = {
      id: roundId,
      userQuery: currentQuery,
      timestamp: Date.now(),
      resolvedMode: mode,
      deliberation: {
        stage1: initialStage1,
        stage2: initialStage2,
      },
      synthesis: { content: '', status: 'idle' },
      attachedImages: imageFiles.length > 0 ? imageFiles : undefined,
    };

    dispatch({ type: 'ADD_ROUND', payload: newRound });
    addRoundToActiveSession(newRound);

    await runRoundExecution(roundId, currentQuery, imageFiles.length > 0 ? imageFiles : undefined, mode);
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 dark:text-slate-200 font-sans antialiased overflow-hidden selection:bg-cyan-500/20 selection:text-cyan-200 relative">
      {/* Mobile backdrop overlay for sidebar */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-30 sm:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar for Deliberation Threads */}
      <aside
        className={`${
          isSidebarOpen ? 'w-72 border-r' : 'w-0 border-r-0'
        } shrink-0 bg-white dark:bg-slate-900/95 backdrop-blur-md border-slate-200 dark:border-slate-700/80 transition-all duration-300 ease-in-out flex flex-col h-full z-40 overflow-hidden relative`}
      >
        {/* Sidebar Header */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare size={16} className="text-cyan-400 shrink-0" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-200 font-mono truncate">
              Deliberation Threads
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="p-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            title="Close sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* Sidebar Action & Search */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-700/50 space-y-2">
          <button
            type="button"
            onClick={() => createNewSession()}
            className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-cyan-950/40 transition-all"
          >
            <Plus size={14} /> New Thread
          </button>

          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-2.5 text-slate-500 dark:text-slate-400" />
            <input
              type="text"
              placeholder="Filter threads..."
              value={sessionSearchQuery}
              onChange={(e) => setSessionSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 font-sans"
            />
            {sessionSearchQuery && (
              <button
                type="button"
                onClick={() => setSessionSearchQuery('')}
                className="absolute right-2 top-2 text-slate-500 dark:text-slate-400 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <div className="text-xs text-slate-500 dark:text-slate-400 text-center py-8 font-mono">
              {sessionSearchQuery ? 'No matching threads' : 'No saved threads'}
            </div>
          ) : (
            filteredSessions.map((s) => {
              const isActive = s.id === activeSessionId;
              return (
                <div
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={`group relative p-2.5 rounded-lg text-xs cursor-pointer transition-all flex items-start justify-between gap-2 border ${
                    isActive
                      ? 'bg-slate-100/90 dark:bg-slate-800/90 border-cyan-500/50 text-slate-800 dark:text-slate-100 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100/50 border-slate-200 dark:border-slate-700/40 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-medium truncate leading-snug">{s.title || 'Untitled Session'}</div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(s.updatedAt || s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                      <span>•</span>
                      <span>{s.rounds?.length || 0} {s.rounds?.length === 1 ? 'round' : 'rounds'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete thread "${s.title || 'Untitled Session'}" and its entire chat history?`)) {
                        deleteSession(s.id);
                      }
                    }}
                    className="text-slate-400 hover:text-red-500 hover:bg-red-500/10 dark:hover:bg-red-950/40 p-1.5 rounded transition-all shrink-0"
                    title="Delete thread and history"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer */}
        {sessions.length > 0 && (
          <div className="p-2 border-t border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/60">
            <button
              type="button"
              onClick={() => {
                if (confirm('Clear all stored deliberation threads?')) {
                  clearAllSessions();
                }
              }}
              className="w-full text-left text-[11px] text-red-400 hover:text-red-300 p-2 rounded hover:bg-red-950/30 transition-colors flex items-center justify-center gap-1.5 font-mono"
            >
              <Trash2 size={12} /> Clear All Threads ({sessions.length})
            </button>
          </div>
        )}
      </aside>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto relative" onScroll={handleMainScroll}>
        {/* Header */}
        <header className="sticky top-0 z-30 bg-slate-50 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-700/80 px-2.5 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 shrink">
            {!isSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-600 transition-colors flex items-center gap-1 text-xs font-mono shrink-0"
                title="Open Deliberation Threads"
              >
                <PanelLeft size={16} className="text-cyan-400" />
                <span className="hidden sm:inline">Threads ({sessions.length})</span>
              </button>
            )}
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-950/50 shrink-0">
              <Sparkles size={16} className="sm:hidden" />
              <Sparkles size={18} className="hidden sm:block" />
            </div>
            <div className="min-w-0 truncate">
              <h1 className="font-bold text-xs sm:text-base tracking-tight text-slate-800 dark:text-slate-100 truncate">
                AI Council
              </h1>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 hidden md:flex items-center gap-2">
                <span>Multi-Model Deliberation Engine</span>
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-800/60 shadow-sm"
                  title={`Total Tokens: ${sessionCostMetrics.totalTokens.toLocaleString()}
• Prompt Tokens: ${sessionCostMetrics.promptTokens.toLocaleString()} (${formatCost(sessionCostMetrics.promptCost)})
• Completion Tokens: ${sessionCostMetrics.completionTokens.toLocaleString()} (${formatCost(sessionCostMetrics.completionCost)})`}
                >
                  <DollarSign size={11} className="text-emerald-400" />
                  <span className="font-bold">{formatCost(sessionCostMetrics.totalCost)}</span>
                  <span className="text-slate-500 dark:text-slate-400 text-[9px] border-l border-emerald-800/80 pl-1.5">
                    {sessionCostMetrics.promptTokens > 1000 ? `${(sessionCostMetrics.promptTokens / 1000).toFixed(1)}k in` : `${sessionCostMetrics.promptTokens} in`} / {sessionCostMetrics.completionTokens > 1000 ? `${(sessionCostMetrics.completionTokens / 1000).toFixed(1)}k out` : `${sessionCostMetrics.completionTokens} out`}
                  </span>
                </span>
                {basicMode && (
                  <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded-md border border-cyan-800/60">
                    Consensus View: Showing consensus only — full debate runs in background
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
            {/* Clear Thread History Button */}
            {activeSession && rounds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Clear chat history for this thread? All messages in this deliberation will be deleted.')) {
                    handleClearActiveHistory();
                  }
                }}
                className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 transition-colors flex items-center gap-1.5 text-xs font-semibold shadow-sm shrink-0"
                title="Clear chat history for the current thread"
              >
                <Trash2 size={14} />
                <span className="hidden sm:inline">Clear History</span>
              </button>
            )}

            {/* Google Search Grounding Quick Toggle */}
            <button
              type="button"
              onClick={() => updateEnableSearchGrounding(!settings.enableSearchGrounding)}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm shrink-0 ${
                settings.enableSearchGrounding
                  ? 'bg-emerald-500/10 dark:bg-emerald-950/60 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title={settings.enableSearchGrounding ? "Search Grounding active: Gemini models will fact-check using live Google Search" : "Enable Search Grounding for live web fact-checking"}
            >
              <Globe size={14} className={settings.enableSearchGrounding ? 'text-emerald-500 shrink-0 animate-pulse' : 'text-slate-400 shrink-0'} />
              <span className="hidden md:inline">Google Search</span>
              <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${settings.enableSearchGrounding ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                {settings.enableSearchGrounding ? 'ON' : 'OFF'}
              </span>
            </button>

            {/* Consensus View / Full Debate Toggle */}
            <button
              type="button"
              onClick={toggleBasicMode}
              className={`p-1.5 sm:px-3 sm:py-1.5 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm shrink-0 ${
                basicMode
                  ? 'bg-cyan-500/10 dark:bg-cyan-950/60 border-cyan-500/50 text-cyan-700 dark:text-cyan-300 ring-1 ring-cyan-500/30'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title={
                basicMode
                  ? "Consensus View active: Showing consensus only — full debate runs in background"
                  : "Full Debate active: Showing all persona stage outputs and peer reviews"
              }
            >
              {basicMode ? (
                <>
                  <Eye size={14} className="text-cyan-500 shrink-0" />
                  <span className="hidden sm:inline">Consensus View</span>
                </>
              ) : (
                <>
                  <EyeOff size={14} className="text-slate-400 shrink-0" />
                  <span className="hidden sm:inline">Full Debate</span>
                </>
              )}
            </button>

            {/* Header Actions Component */}
            <HeaderActions
              executionMode={settings.executionMode || 'auto'}
              onUpdateExecutionMode={updateExecutionMode}
              isProCompareEnabled={isProCompareEnabled}
              onToggleProCompare={handleToggleProCompare}
              theme={theme}
              onSetTheme={setTheme}
              onOpenAuditModal={() => setIsAuditModalOpen(true)}
              onExportSessions={exportSessionsJSON}
              onImportSessions={handleImportSessionsFile}
              onOpenSettings={() => setIsSettingsOpen(true)}
              maxRoundCostCeiling={settings.maxRoundCostCeiling}
              stopAfterStage1={settings.stopAfterStage1}
              useSingleModelForSimple={settings.useSingleModelForSimple}
            />

            {/* New Thread Button */}
            <button
              type="button"
              onClick={() => createNewSession()}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors flex items-center gap-1.5 text-xs font-semibold shadow-sm shrink-0"
              title="Start New Deliberation Thread"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">New Thread</span>
            </button>
          </div>
        </header>

      {/* Main Content Feed */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 space-y-6 pb-32">
        {!basicMode && (
          <CouncilSummaryBar
            presetId={activePresetId}
            answerMode={settings.executionMode || 'auto'}
            taskDomain={activeAppliedDomain || undefined}
            personas={personas}
            synthesizer={synthesizer}
            rawModels={rawModelsCatalog}
            updatedAt={recommendationMetadata?.updatedAt}
          />
        )}
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
                isCollapsed={collapsedRoundIds.has(round.id)}
                onToggleCollapse={toggleRoundCollapse}
                onReRunRound={reRunRoundDeliberation}
                onEditPrompt={handleEditPrompt}
                onResumeRound={resumeIncompleteRound}
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
        removeAttachedFile={removeAttachedFile}
        fileInputRef={fileInputRef}
        handleFileUpload={handleFileUpload}
        handleDrop={handleDrop}
        handleDragOver={handleDragOver}
        handlePaste={handlePaste}
        queryTokens={queryTokens}
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
        stopAfterStage1={settings.stopAfterStage1}
        setStopAfterStage1={updateStopAfterStage1}
        useSingleModelForSimple={settings.useSingleModelForSimple}
        setUseSingleModelForSimple={updateUseSingleModelForSimple}
        maxRoundCostCeiling={settings.maxRoundCostCeiling}
      />

      {/* Settings Modal */}
      <SettingsPanel
        isProCompareEnabled={isProCompareEnabled}
        handleToggleProCompare={handleToggleProCompare}
        setIsAuditModalOpen={setIsAuditModalOpen}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={settings.apiKey}
        setApiKey={updateApiKey}
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

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-white dark:bg-slate-900 border border-cyan-500/60 text-cyan-200 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-mono flex items-center gap-2 animate-bounce cursor-pointer"
          onClick={() => setToastMessage(null)}
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setToastMessage(null);
            }}
            className="text-cyan-400 hover:text-cyan-100 ml-1 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  </div>

              
  );
};
