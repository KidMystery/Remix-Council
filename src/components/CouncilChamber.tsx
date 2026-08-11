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
import { applyPreset, checkDuplicateModels, PresetId } from '../lib/presets';
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
import {
  streamPersonaWithFallback,
  getStoredFallbackEvents,
  FallbackEvent,
  computeOrderedBackupList,
} from '../lib/fallbackManager';
import {
  Settings as SettingsIcon,
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
  Loader2,
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
    <div className={`p-4 rounded-xl bg-white/80 border ${colorMap.border} space-y-3 animate-pulse shadow-sm`}>
      <div className="flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center space-x-2">
          <Loader2 size={13} className={`animate-spin ${colorMap.text}`} />
          <span className={`font-semibold ${colorMap.text}`}>{stageLabel}</span>
        </div>
        {model && (
          <span className="text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 font-mono truncate max-w-[140px]">
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

      const defaultModels = savedModels
        ? JSON.parse(savedModels)
        : {
            skeptic: 'google/gemini-2.0-flash-001',
            visionary: 'anthropic/claude-3.5-haiku',
            pragmatist: 'openai/gpt-4o-mini',
            synthesizer: 'google/gemini-2.0-flash-001',
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
      };
    } catch {
      return {
        apiKey:  '',
        defaultModels: {
          skeptic: 'google/gemini-2.0-flash-001',
          visionary: 'anthropic/claude-3.5-haiku',
          pragmatist: 'openai/gpt-4o-mini',
          synthesizer: 'google/gemini-2.0-flash-001',
        },
        temperature: 0.7,
        maxTokens: 4000,
        executionMode: 'auto',
        quickPanelMaxTokens: 350,
        synthesisMaxTokens: 500,
        panelTimeoutSeconds: 30,
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
    clearAllSessions,
    addRoundToActiveSession,
    updateRoundInActiveSession,
    deleteRoundFromActiveSession,
  } = useSessionManager();

  // Council Reducer for decoupled state updates
  const { rounds, dispatch, setRounds } = useCouncilReducer(activeSession?.rounds || []);

  // Sync reducer rounds when active session changes
  useEffect(() => {
    const newRounds = activeSession?.rounds || [];
    setRounds(newRounds);
    
    // Auto-collapse all but the last round when loading a session
    if (newRounds.length > 0) {
      setCollapsedRoundIds(new Set(newRounds.slice(0, -1).map(r => r.id)));
    } else {
      setCollapsedRoundIds(new Set());
    }
  }, [activeSessionId, setRounds]);

  // Persona Stream Custom Hook
  const { streamPersona } = usePersonaStream();
  const { speak, stop: stopSpeech, speakingId } = useSpeech();
  
  // Model Recommendations App-Load & 15-min background check hook
  const { metadata: recommendationMetadata, rawModelsCatalog } = useModelRecommendations();
  const [activePresetId, setActivePresetId] = useState<PresetId>('fast_and_free');

  const [query, setQuery] = useState('');
  const [isDeliberating, setIsDeliberating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSessionListOpen, setIsSessionListOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [expandedTranscriptIds, setExpandedTranscriptIds] = useState<Set<string>>(new Set());
  const [fallbackLogs, setFallbackLogs] = useState<FallbackEvent[]>(() => getStoredFallbackEvents());
  const [isFallbackModalOpen, setIsFallbackModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isProCompareEnabled, setIsProCompareEnabled] = useState<boolean>(() => getProCompareSetting());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleToggleProCompare = () => {
    const nextVal = !isProCompareEnabled;
    setIsProCompareEnabled(nextVal);
    setProCompareSetting(nextVal);
    setToastMessage(nextVal ? '⚡ Blind Pro Compare (Phase 2) Enabled' : '⏸️ Blind Pro Compare Disabled');
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

    setToastMessage('🔄 Role model assignments rotated across active council members');
    setTimeout(() => setToastMessage(null), 3500);
  };

  const toggleTranscriptExpand = (roundId: string) => {
    setExpandedTranscriptIds((prev) => {
      const next = new Set(prev);
      if (next.has(roundId)) next.delete(roundId);
      else next.add(roundId);
      return next;
    });
  };

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
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('light');

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

      if (file.size > 20 * 1024 * 1024) {
        setFileError(`File too large: ${file.name}. Maximum size is 20MB.`);
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
          setToastMessage(`📦 Extracted ${zipResult.extractedCodeFilesCount} code files from ${file.name}`);
        } catch (error) {
          console.error("Error reading zip archive:", error);
          setFileError(`Could not read code from zip file: ${file.name}`);
        }
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const text = await extractTextFromPDF(file);
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
          const text = event.target?.result;
          if (typeof text === 'string') {
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

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer && e.dataTransfer.items) {
      await processFiles(e.dataTransfer.items);
    } else if (e.dataTransfer && e.dataTransfer.files) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
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

  const sessionCostMetrics = countTotalSessionCost(rounds);
  const dupInfo = checkDuplicateModels(personas, synthesizer);

  const handleApplyPreset = (presetId: PresetId) => {
    setActivePresetId(presetId);
    const { updatedPersonas, updatedSynthesizer } = applyPreset(presetId, personas, synthesizer);
    setPersonas(updatedPersonas);
    setSynthesizer(updatedSynthesizer);

    // Persist model settings to localStorage
    const defaultModelsMap: Record<string, string> = {};
    updatedPersonas.forEach(p => { defaultModelsMap[p.id] = p.model; });
    defaultModelsMap['synthesizer'] = updatedSynthesizer.model;
    localStorage.setItem('council_default_models', JSON.stringify(defaultModelsMap));
  };

  useEffect(() => {
    const models: Record<string, string> = {
      synthesizer: synthesizer.model || 'google/gemini-2.0-flash-001'
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

  const totalSessionTokens = countTotalSessionTokens(rounds);
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

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

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
      console.log(`[Synthesis Phase] Initiating stream with model: ${synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.0-flash-001'}`);
      console.log(`[Synthesis Phase] Messages payload length: ${JSON.stringify(chairmanMessages).length} chars`);
      
      const streamPromise = streamPersona({
        personaId: 'synthesizer',
        apiKey: settings.apiKey,
        model: synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.0-flash-001',
        messages: chairmanMessages,
        temperature: 0.5,
        maxTokens: Math.min(Math.max((settings.maxTokens || 4000) * 2, 8000), 8192),
        signal,
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
      await streamPromise;
      console.log(`[Synthesis Phase] Stream completed successfully. Total length: ${fullSynthesis.length} characters.`);

      dispatch({ type: 'FINISH_SYNTHESIS', payload: { roundId: targetRoundId } });
      updateRoundInActiveSession(targetRoundId, (r) => ({
        ...r,
        synthesis: { ...r.synthesis, content: fullSynthesis, status: 'completed' },
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
      const selectedModelId = p.model || settings.defaultModels[p.id] || 'google/gemini-2.0-flash-001';
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
    const synthSelectedModel = synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.0-flash-001';
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

  const regenerateSynthesis = async (roundId: string) => {
    if (isDeliberating) return;

    const round = rounds.find((r) => r.id === roundId);
    if (!round) return;

    setIsDeliberating(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const stage1Map = (round.deliberation?.stage1 || (round as any).responses || {}) as Record<string, PersonaResponse>;
    const stage2Map = (round.deliberation?.stage2 || {}) as Record<string, PersonaResponse>;

    try {
      await runSynthesisPhase(roundId, round.userQuery, round.attachedImages, stage1Map, stage2Map, abortController.signal);
    } finally {
      setIsDeliberating(false);
      abortControllerRef.current = null;
    }
  };

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

        await streamPersona({
          personaId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[personaId] || 'google/gemini-2.0-flash-001',
          messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: abortController.signal,
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

        dispatch({
          type: 'FINISH_STAGE1_PERSONA',
          payload: { roundId, personaId, content: fullContent },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [personaId]: { personaId, content: fullContent, status: 'completed' },
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

        await streamPersona({
          personaId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[personaId] || 'google/gemini-2.5-flash',
          messages: stage2Messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: abortController.signal,
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

        dispatch({
          type: 'FINISH_STAGE2_PERSONA',
          payload: { roundId, personaId, content: fullContent },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [personaId]: { personaId, content: fullContent, status: 'completed' },
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
            await streamPersona({
              personaId: persona.id,
              apiKey: settings.apiKey,
              model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.0-flash-001',
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

            stage1Map[persona.id] = { personaId: persona.id, content, status: 'completed' };
            dispatch({ type: 'FINISH_STAGE1_PERSONA', payload: { roundId, personaId: persona.id, content } });
            updateRoundInActiveSession(roundId, (r) => ({
              ...r,
              deliberation: {
                ...r.deliberation,
                stage1: { ...r.deliberation?.stage1, [persona.id]: { personaId: persona.id, content, status: 'completed' } },
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
              await streamPersona({
                personaId: persona.id,
                apiKey: settings.apiKey,
                model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.0-flash-001',
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

              stage2Map[persona.id] = { personaId: persona.id, content, status: 'completed' };
              dispatch({ type: 'FINISH_STAGE2_PERSONA', payload: { roundId, personaId: persona.id, content } });
              updateRoundInActiveSession(roundId, (r) => ({
                ...r,
                deliberation: {
                  ...r.deliberation,
                  stage2: { ...r.deliberation?.stage2, [persona.id]: { personaId: persona.id, content, status: 'completed' } },
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

    const activePersonas = personas.filter((p) => p.enabled !== false);
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

      try {
        const res = await streamPersonaWithFallback({
          personaId: persona.id,
          personaName: persona.name,
          roundId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.0-flash-001',
          messages,
          temperature: settings.temperature,
          maxTokens: mode === 'quick_panel' ? (settings.quickPanelMaxTokens || 350) : settings.maxTokens,
          signal: perCallSignal,
          activePersonas,
          synthesizer,
          isFreeOnlyPreset: activePersonas.every((p) => (p.model || '').includes(':free')),
          onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
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

        stage1Outputs[persona.id] = {
          personaId: persona.id,
          content: res.content,
          status: 'completed',
        };

        dispatch({
          type: 'FINISH_STAGE1_PERSONA',
          payload: { roundId, personaId: persona.id, content },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [persona.id]: { personaId: persona.id, content, status: 'completed' },
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

      try {
        const res = await streamPersonaWithFallback({
          personaId: persona.id,
          personaName: persona.name,
          roundId,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.0-flash-001',
          messages: stage2Messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: abortController.signal,
          activePersonas,
          synthesizer,
          isFreeOnlyPreset: activePersonas.every((p) => (p.model || '').includes(':free')),
          onFallbackTriggered: (event) => setFallbackLogs((prev) => [event, ...prev]),
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

        stage2Outputs[persona.id] = {
          personaId: persona.id,
          content: res.content,
          status: 'completed',
        };

        dispatch({
          type: 'FINISH_STAGE2_PERSONA',
          payload: { roundId, personaId: persona.id, content },
        });

        updateRoundInActiveSession(roundId, (r) => ({
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [persona.id]: { personaId: persona.id, content, status: 'completed' },
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
      const synthModel = synthesizer.model || settings.defaultModels['synthesizer'] || 'google/gemini-2.0-flash-001';

      await streamPersona({
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

      dispatch({ type: 'FINISH_SYNTHESIS', payload: { roundId } });
      updateRoundInActiveSession(roundId, (r) => ({
        ...r,
        synthesis: { content: fullSynthesis, status: 'completed', model: synthModel },
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

  const handleDeepenAnswer = async (roundId: string) => {
    if (isDeliberating) return;
    const round = rounds.find((r) => r.id === roundId);
    if (!round) return;

    await runRoundExecution(round.id, round.userQuery, round.attachedImages, 'deep_council');
  };

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

    const roundId = `round-${Date.now()}`;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const initialStage1: Record<string, PersonaResponse> = {};
    const initialStage2: Record<string, PersonaResponse> = {};
    activePersonas.forEach((p) => {
      initialStage1[p.id] = { personaId: p.id, content: '', status: 'streaming' };
      initialStage2[p.id] = { personaId: p.id, content: '', status: 'idle' };
    });

    const newRound: CouncilRound = {
      id: roundId,
      userQuery: currentQuery,
      timestamp: Date.now(),
      deliberation: {
        stage1: initialStage1,
        stage2: initialStage2,
      },
      synthesis: { content: '', status: 'idle' },
      attachedImages: imageFiles.length > 0 ? imageFiles : undefined,
    };

    // Append round via reducer & active session manager
    dispatch({ type: 'ADD_ROUND', payload: newRound });
    addRoundToActiveSession(newRound);

    // PHASE 1: Initial Proposals (using Archivist Context with Hierarchical Memory)
    const stage1Outputs: Record<string, PersonaResponse> = {};

    const stage1Promises = activePersonas.map(async (persona) => {
      const messages = await buildArchivistContext({
        systemPrompt: persona.systemPrompt,
        userQuery: currentQuery,
        attachedImages: newRound.attachedImages,
        rounds,
        apiKey: settings.apiKey,
        signal: abortController.signal,
      });

      let content = '';

      try {
        await streamPersona({
          personaId: persona.id,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.0-flash-001',
          messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: abortController.signal,
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
                    },
                  },
                },
              };
            });
          },
        });

        stage1Outputs[persona.id] = {
          personaId: persona.id,
          content,
          status: 'completed',
        };

        dispatch({
          type: 'FINISH_STAGE1_PERSONA',
          payload: { roundId, personaId: persona.id, content },
        });

        updateRoundInActiveSession(roundId, (r) => {
          const existing = r.deliberation?.stage1?.[persona.id];
          return {
            ...r,
            deliberation: {
              ...r.deliberation,
              stage1: {
                ...r.deliberation?.stage1,
                [persona.id]: { ...existing, content, status: 'completed' },
              },
            },
          };
        });
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        const errorMsg = err.message || 'Failed Stage 1 query';
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
                  status: 'error',
                  error: errorMsg,
                },
              },
            },
          };
        });
      }
    });

    await Promise.allSettled(stage1Promises);

    if (abortController.signal.aborted) return;

    // Single Council Member Check: Skip Stage 2 Peer Review & Stage 3 Synthesis
    if (activePersonas.length === 1) {
      setIsDeliberating(false);
      abortControllerRef.current = null;
      return;
    }

    // PHASE 2: Peer Review & Cross-Exam
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

    const stage2Promises = activePersonas.map(async (persona) => {
      const peerProposals = Object.values(stage1Outputs)
        .filter((resp) => resp.personaId !== persona.id && resp.personaId !== 'synthesizer')
        .map((resp) => {
          const p = personas.find((item) => item.id === resp.personaId);
          return `### ${p?.name || resp.personaId} (${p?.role}):\n${resp.content || '[No output/Error]'}`;
        })
        .join('\n\n');

      const queryContentStr = `User Question: "${currentQuery}"\n\n--- Initial Stage 1 Proposals from Other Council Members ---\n${peerProposals}\n\nTask: Peer review the proposals above. Point out unaddressed risks, test assumptions, highlight valuable ideas, and refine your position.`;

      const stage2Messages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
        { role: 'system', content: persona.systemPrompt },
      ];
      
      if (newRound.attachedImages && newRound.attachedImages.length > 0) {
        stage2Messages.push({
          role: 'user' as const,
          content: [
            { type: 'text', text: queryContentStr },
            ...newRound.attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } }))
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
        await streamPersona({
          personaId: persona.id,
          apiKey: settings.apiKey,
          model: persona.model || settings.defaultModels[persona.id] || 'google/gemini-2.0-flash-001',
          messages: stage2Messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: abortController.signal,
          onToken: (chunk) => {
            content += chunk;
            dispatch({
              type: 'UPDATE_STAGE2_TOKEN',
              payload: { roundId, personaId: persona.id, chunk },
            });
            updateRoundInActiveSession(roundId, (r) => {
              const existing = r.deliberation?.stage2?.[persona.id];
              return {
                ...r,
                deliberation: {
                  ...r.deliberation,
                  stage2: {
                    ...r.deliberation?.stage2,
                    [persona.id]: {
                      ...existing,
                      content: (existing?.content || '') + chunk,
                    },
                  },
                },
              };
            });
          },
        });

        stage2Outputs[persona.id] = {
          personaId: persona.id,
          content,
          status: 'completed',
        };

        dispatch({
          type: 'FINISH_STAGE2_PERSONA',
          payload: { roundId, personaId: persona.id, content },
        });

        updateRoundInActiveSession(roundId, (r) => {
          const existing = r.deliberation?.stage2?.[persona.id];
          return {
            ...r,
            deliberation: {
              ...r.deliberation,
              stage2: {
                ...r.deliberation?.stage2,
                [persona.id]: { ...existing, content, status: 'completed' },
              },
            },
          };
        });
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
        updateRoundInActiveSession(roundId, (r) => {
          const existing = r.deliberation?.stage2?.[persona.id];
          return {
            ...r,
            deliberation: {
              ...r.deliberation,
              stage2: {
                ...r.deliberation?.stage2,
                [persona.id]: {
                  ...existing,
                  status: 'error',
                  error: errorMsg,
                },
              },
            },
          };
        });
      }
    });

    await Promise.allSettled(stage2Promises);

    if (abortController.signal.aborted) return;

    // PHASE 3: Synthesis
    try {
      await runSynthesisPhase(roundId, currentQuery, newRound.attachedImages, stage1Outputs, stage2Outputs, abortController.signal);
    } finally {
      setIsDeliberating(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex h-screen bg-[#f5f5f0] text-slate-800 font-sans antialiased overflow-hidden selection:bg-cyan-500/20 selection:text-cyan-200">
      {/* Sidebar for Deliberation Threads */}
      <aside
        className={`${
          isSidebarOpen ? 'w-72 border-r' : 'w-0 border-r-0'
        } shrink-0 bg-white/95 backdrop-blur-md border-slate-200/80 transition-all duration-300 ease-in-out flex flex-col h-full z-40 overflow-hidden relative`}
      >
        {/* Sidebar Header */}
        <div className="p-3.5 border-b border-slate-200/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare size={16} className="text-cyan-400 shrink-0" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-700 font-mono truncate">
              Deliberation Threads
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            title="Close sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* Sidebar Action & Search */}
        <div className="p-3 border-b border-slate-200/50 space-y-2">
          <button
            type="button"
            onClick={() => createNewSession()}
            className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-cyan-950/40 transition-all"
          >
            <Plus size={14} /> New Thread
          </button>

          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filter threads..."
              value={sessionSearchQuery}
              onChange={(e) => setSessionSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#f5f5f0] border border-slate-200 text-xs text-slate-700 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 font-sans"
            />
            {sessionSearchQuery && (
              <button
                type="button"
                onClick={() => setSessionSearchQuery('')}
                className="absolute right-2 top-2 text-slate-500 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8 font-mono">
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
                      ? 'bg-slate-100/90 border-cyan-500/50 text-slate-800 shadow-sm'
                      : 'bg-[#f5f5f0]/40 hover:bg-slate-100/50 border-slate-200/40 text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-medium truncate leading-snug">{s.title || 'Untitled Session'}</div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
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
                      if (confirm('Delete this deliberation thread?')) {
                        deleteSession(s.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1 rounded hover:bg-red-950/40 transition-all shrink-0"
                    title="Delete thread"
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
          <div className="p-2 border-t border-slate-200/80 bg-white/60">
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
        <header className="sticky top-0 z-30 bg-[#f5f5f0]/90 backdrop-blur-md border-b border-slate-200/80 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {!isSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="p-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors flex items-center gap-1.5 text-xs font-mono"
                title="Open Deliberation Threads"
              >
                <PanelLeft size={16} className="text-cyan-400" />
                <span className="hidden sm:inline">Threads ({sessions.length})</span>
              </button>
            )}
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-950/50">
              <Sparkles size={18} />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-slate-800 flex items-center gap-2">
                AI Council Chamber
              </h1>
              <p className="text-[11px] text-slate-500 flex items-center gap-2">
                <span>Multi-Model Deliberation Engine</span>
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-800/60 shadow-sm"
                  title={`Total Tokens: ${sessionCostMetrics.totalTokens.toLocaleString()}\n• Prompt Tokens: ${sessionCostMetrics.promptTokens.toLocaleString()} (${formatCost(sessionCostMetrics.promptCost)})\n• Completion Tokens: ${sessionCostMetrics.completionTokens.toLocaleString()} (${formatCost(sessionCostMetrics.completionCost)})`}
                >
                  <DollarSign size={11} className="text-emerald-400" />
                  <span className="font-bold">{formatCost(sessionCostMetrics.totalCost)}</span>
                  <span className="text-slate-500 text-[9px] border-l border-emerald-800/80 pl-1.5">
                    {sessionCostMetrics.promptTokens > 1000 ? `${(sessionCostMetrics.promptTokens / 1000).toFixed(1)}k in` : `${sessionCostMetrics.promptTokens} in`} / {sessionCostMetrics.completionTokens > 1000 ? `${(sessionCostMetrics.completionTokens / 1000).toFixed(1)}k out` : `${sessionCostMetrics.completionTokens} out`}
                  </span>
                </span>
              </p>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => createNewSession()}
              className="p-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
              title="New Deliberation"
            >
              <Plus size={16} />
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors relative"
              title="Open Settings"
            >
              <SettingsIcon size={16} />
            </button>
          </div>
        </header>

      {/* Main Content Feed */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6 space-y-6 pb-32">
        {(() => {
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
            <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-cyan-400 shadow-xl">
              <Sparkles size={32} />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-xl font-bold text-slate-700">Convened for Deliberation</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
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
                  className="text-xs font-mono text-slate-500 hover:text-slate-700 transition-colors flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/50 hover:bg-slate-100/80 border border-slate-200"
                >
                  {collapsedRoundIds.size > 0 ? (
                    <><ChevronDown size={14} /> Show All History</>
                  ) : (
                    <><ChevronUp size={14} /> Hide Past Rounds</>
                  )}
                </button>
              </div>
            )}
            {rounds.map((round, idx) => {
            const isCollapsed = collapsedRoundIds.has(round.id);
            const displayQuery = round.userQuery.includes('\n\nUser Question:\n') 
              ? round.userQuery.split('\n\nUser Question:\n')[1] 
              : round.userQuery.startsWith('--- Attached File:') 
                ? '[Attached Files Only]' 
                : round.userQuery;

            return (
            <div key={round.id} className="space-y-6 border-b border-slate-200/80 pb-8 last:border-0">
              {/* User Query Banner */}
              <div 
                className="p-4 rounded-xl bg-white/90 hover:bg-slate-100/90 border border-slate-200 flex items-start justify-between space-x-4 shadow-md transition-colors cursor-pointer"
                onClick={() => toggleRoundCollapse(round.id)}
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider">
                      User Decision / Query (Round {idx + 1})
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(round.userQuery);
                        setCopiedId(`prompt-${round.id}`);
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      className="text-slate-500 hover:text-slate-600 transition-colors flex items-center justify-center"
                      title="Copy prompt"
                    >
                      {copiedId === `prompt-${round.id}` ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                    </button>
                    {idx > 1 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-800/50">
                        <Brain size={10} /> Archivist Memory Active
                      </span>
                    )}
                    {!isCollapsed && (() => {
                      const activePersonas = personas.filter((p) => p.enabled !== false);
                      const statusInfo = getRoundIncompleteStage(round, activePersonas);

                      if (statusInfo.isIncomplete) {
                        return (
                          <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => resumeIncompleteRound(round.id)}
                              disabled={isDeliberating}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-200 bg-amber-950/90 hover:bg-amber-900/90 px-2 py-0.5 rounded border border-amber-600/80 transition-colors shadow-sm disabled:opacity-50"
                              title={`Resume deliberation at ${statusInfo.description}`}
                            >
                              <Play size={10} className={isDeliberating ? 'animate-spin text-amber-300' : 'fill-current text-amber-300'} />
                              <span>Resume {statusInfo.description}</span>
                            </button>
                            <button
                              onClick={() => reRunRoundDeliberation(round.id)}
                              disabled={isDeliberating}
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-700 bg-slate-100/80 hover:bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60 transition-colors disabled:opacity-50"
                              title="Re-run all stages from scratch"
                            >
                              <RefreshCw size={10} />
                              <span>Re-run All</span>
                            </button>
                            <button
                              onClick={() => handleEditPrompt(round.id)}
                              disabled={isDeliberating}
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-700 bg-slate-100/80 hover:bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60 transition-colors disabled:opacity-50"
                              title="Edit this prompt"
                            >
                              <Edit3 size={10} />
                              <span>Edit Prompt</span>
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Delete this prompt attempt?')) {
                                  handleDeleteRound(round.id);
                                }
                              }}
                              disabled={isDeliberating}
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/60 px-2 py-0.5 rounded border border-red-800/50 transition-colors disabled:opacity-50"
                              title="Delete this prompt attempt"
                            >
                              <Trash2 size={10} />
                              <span>Delete Prompt</span>
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => reRunRoundDeliberation(round.id)}
                            disabled={isDeliberating}
                            className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-cyan-300 bg-slate-100/80 hover:bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60 transition-colors disabled:opacity-50"
                            title="Re-run deliberation for this query"
                          >
                            <RefreshCw size={10} />
                            <span>Re-run Deliberation</span>
                          </button>
                          <button
                            onClick={() => handleEditPrompt(round.id)}
                            disabled={isDeliberating}
                            className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-cyan-300 bg-slate-100/80 hover:bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60 transition-colors disabled:opacity-50"
                            title="Edit this prompt"
                          >
                            <Edit3 size={10} />
                            <span>Edit Prompt</span>
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Delete this prompt attempt?')) {
                                handleDeleteRound(round.id);
                              }
                            }}
                            disabled={isDeliberating}
                            className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/60 px-2 py-0.5 rounded border border-red-800/50 transition-colors disabled:opacity-50"
                            title="Delete this prompt attempt"
                          >
                            <Trash2 size={10} />
                            <span>Delete Prompt</span>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  <p className={`text-sm font-semibold text-slate-800 ${isCollapsed ? 'truncate' : 'line-clamp-3'}`}>
                    {isCollapsed ? (displayQuery.length > 80 ? displayQuery.substring(0, 80) + '...' : displayQuery) : displayQuery}
                  </p>
                  {!isCollapsed && round.attachedImages && round.attachedImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {round.attachedImages.map((img, i) => (
                        <div key={i} className="relative group rounded border border-slate-200 bg-[#f5f5f0] overflow-hidden">
                          <img src={img.url} alt={img.name} className="w-12 h-12 object-cover" />
                          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-50">
                            <img src={img.url} alt={img.name} className="max-w-[300px] max-h-[300px] object-contain rounded border border-slate-200 shadow-2xl bg-[#f5f5f0]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
                    {new Date(round.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isCollapsed ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronUp size={14} className="text-slate-500" />}
                </div>
              </div>

              {!isCollapsed && (
                <>
              {/* Stage 1: Initial Proposals / Quick Panel Answers */}
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    {round.resolvedMode === 'quick_panel' ? (
                      <span className="text-amber-300 flex items-center gap-1.5">
                        <Zap size={13} className="text-amber-400" />
                        Quick Panel Responses
                      </span>
                    ) : Object.keys(round.deliberation?.stage1 || {}).length <= 1 ? (
                      'Single Council Member Evaluation'
                    ) : (
                      'Stage 1: Initial Proposals'
                    )}
                  </h3>
                </div>
                <div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">
                  {personas
                    .filter((persona) => round.deliberation?.stage1?.[persona.id] || persona.enabled !== false)
                    .map((persona) => {
                      const resp = round.deliberation?.stage1?.[persona.id] || (round as any).responses?.[persona.id];
                      const copyKey = `${round.id}-stage1-${persona.id}`;
                      return (
                        <div
                          key={persona.id}
                          className={`p-4 sm:p-5 rounded-xl bg-white/90 dark:bg-white/80 border ${persona.color} flex flex-col justify-between space-y-4 shadow-sm hover:shadow-md transition-all duration-200 min-w-0 max-w-full overflow-hidden break-words h-full`}
                        >
                          <div className="space-y-3 min-w-0">
                            <div className="flex items-center justify-between border-b border-slate-200/60 pb-2.5 min-w-0 gap-2">
                              <div className="flex items-center space-x-2.5 min-w-0 truncate">
                                <span className="text-xl shrink-0">{persona.avatar}</span>
                                <div className="min-w-0 truncate">
                                  <h3 className="font-bold text-sm text-slate-800 leading-tight truncate">{persona.name}</h3>
                                  <p className="text-[11px] text-slate-500 truncate">{persona.role}</p>
                                </div>
                              </div>
                              <div className="flex items-center space-x-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={isDeliberating}
                                  onClick={() => handleRegeneratePersona(round.id, persona.id, 1)}
                                  className="text-slate-500 hover:text-cyan-300 disabled:opacity-30 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                  title="Regenerate persona proposal"
                                >
                                  <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-cyan-400' : ''} />
                                </button>
                                {resp?.content && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => speak(resp.content, copyKey)}
                                      className={`transition-colors p-1.5 rounded hover:bg-slate-100/80 ${
                                        speakingId === copyKey ? 'text-cyan-400 bg-cyan-950/60 animate-pulse' : 'text-slate-500 hover:text-slate-700'
                                      } flex items-center gap-1 font-medium text-[10px]`}
                                      title={speakingId === copyKey ? 'Stop reading' : 'Read response aloud'}
                                    >
                                      {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                                      <span>{speakingId === copyKey ? 'Stop' : 'Speak'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(copyKey, resp.content)}
                                      className="text-slate-500 hover:text-slate-700 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                      title="Copy response"
                                    >
                                      {copiedId === copyKey ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {resp?.status === 'error' ? (
                              <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 min-w-0 break-words">
                                Error: {resp.error}
                              </div>
                            ) : resp?.content ? (
                              <div className="min-w-0 max-w-full overflow-x-auto break-words">
                                <MessageMarkdown content={resp.content} />
                              </div>
                            ) : (
                              <ThinkingIndicator
                                stageLabel={round.resolvedMode === 'quick_panel' ? 'Quick Answer' : 'Stage 1 Proposal'}
                                personaName={persona.name}
                                role={persona.role}
                                model={persona.model || settings.defaultModels[persona.id]}
                                accentColor="cyan"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Missing Panelist Indicator */}
                {(() => {
                  const missing = personas.filter(
                    (p) => p.enabled !== false && round.deliberation?.stage1?.[p.id]?.status === 'error'
                  );
                  if (missing.length === 0) return null;
                  return (
                    <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 p-2.5 rounded-xl flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                      <span>Missing panelist responses: <strong>{missing.map((p) => p.name).join(', ')}</strong> (timed out or error)</span>
                    </div>
                  );
                })()}

                {/* Quick Panel Actions Bar */}
                {round.resolvedMode === 'quick_panel' && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 p-3 bg-white/60 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Zap size={14} className="text-amber-400" />
                      <span>Quick Panel Execution Complete</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {(!round.synthesis?.content && round.synthesis?.status !== 'streaming') && (
                        <button
                          type="button"
                          disabled={
                            isDeliberating ||
                            Object.values(round.deliberation?.stage1 || {}).filter((r: PersonaResponse | any) => r.status === 'completed').length < 2
                          }
                          onClick={() => runQuickPanelSynthesis(round.id)}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
                          title="Synthesize panelist answers into a single consolidated view"
                        >
                          <Sparkles size={13} />
                          <span>Synthesize Answers</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isDeliberating}
                        onClick={() => handleDeepenAnswer(round.id)}
                        className="px-3 py-1.5 rounded-lg bg-purple-950 hover:bg-purple-900 text-purple-200 border border-purple-700/60 font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-40"
                        title="Run full 3-stage Deep Council peer review on this query"
                      >
                        <Layers size={13} className="text-purple-400" />
                        <span>Deepen this answer 🏛️</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}
              {round.resolvedMode === 'deep_council' &&
                Object.keys(round.deliberation?.stage1 || {}).length > 1 &&
                round.deliberation?.stage2 &&
                Object.values(round.deliberation.stage2).some(
                  (resp: PersonaResponse | any) => resp?.content || resp?.status === 'streaming'
                ) && (
                  <div className="space-y-3 pt-2 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                        Stage 2: Peer Review & Cross-Examination
                      </h3>
                    </div>
                    <div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">
                      {personas
                        .filter((persona) => round.deliberation?.stage2?.[persona.id])
                        .map((persona) => {
                          const resp = round.deliberation?.stage2?.[persona.id];
                          const copyKey = `${round.id}-stage2-${persona.id}`;
                          if (!resp) return null;
                          return (
                            <div
                              key={`s2-${persona.id}`}
                              className={`p-4 sm:p-5 rounded-xl bg-white/90 dark:bg-white/80 border ${persona.color} flex flex-col justify-between space-y-4 shadow-sm hover:shadow-md transition-all duration-200 min-w-0 max-w-full overflow-hidden break-words h-full`}
                            >
                              <div className="space-y-3 min-w-0">
                                <div className="flex items-center justify-between border-b border-slate-200/60 pb-2.5 min-w-0 gap-2">
                                  <div className="flex items-center space-x-2.5 min-w-0 truncate">
                                    <span className="text-xl shrink-0">{persona.avatar}</span>
                                    <div className="min-w-0 truncate">
                                      <h3 className="font-bold text-sm text-slate-800 leading-tight truncate">{persona.name}</h3>
                                      <p className="text-[11px] text-purple-300/80 truncate">Peer Review</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1 shrink-0">
                                    <button
                                      type="button"
                                      disabled={isDeliberating}
                                      onClick={() => handleRegeneratePersona(round.id, persona.id, 2)}
                                      className="text-slate-500 hover:text-purple-300 disabled:opacity-30 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                      title="Regenerate peer review"
                                    >
                                      <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-purple-400' : ''} />
                                    </button>
                                    {resp?.content && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => speak(resp.content, copyKey)}
                                          className={`transition-colors p-1.5 rounded hover:bg-slate-100/80 ${
                                        speakingId === copyKey ? 'text-purple-400 bg-purple-950/60 animate-pulse' : 'text-slate-500 hover:text-slate-700'
                                      } flex items-center gap-1 font-medium text-[10px]`}
                                          title={speakingId === copyKey ? 'Stop reading' : 'Read response aloud'}
                                        >
                                      {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                                      <span>{speakingId === copyKey ? 'Stop' : 'Speak'}</span>
                                    </button>
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(copyKey, resp.content)}
                                          className="text-slate-500 hover:text-slate-700 transition-colors p-1.5 rounded hover:bg-slate-100/80"
                                          title="Copy response"
                                        >
                                          {copiedId === copyKey ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {resp?.status === 'error' ? (
                                  <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 min-w-0 break-words">
                                    Error: {resp.error}
                                  </div>
                                ) : resp?.content ? (
                                  <div className="min-w-0 max-w-full overflow-x-auto break-words">
                                    <MessageMarkdown content={resp.content} />
                                  </div>
                                ) : (
                                  <ThinkingIndicator
                                    stageLabel="Stage 2 Peer Review"
                                    personaName={persona.name}
                                    role="Peer Reviewer"
                                    model={persona.model || settings.defaultModels[persona.id]}
                                    accentColor="purple"
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

              {/* Stage 3: Chairman Synthesis Section */}
              {Object.keys(round.deliberation?.stage1 || {}).length > 1 &&
                (round.synthesis?.content || round.synthesis?.status === 'streaming') && (
                  <div className="p-6 rounded-2xl bg-gradient-to-b from-amber-950/30 to-slate-900 border border-amber-500/30 shadow-lg space-y-4">
                    <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                      <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                        <span className="text-lg">⚖️</span> {round.resolvedMode === 'quick_panel' ? 'Quick Panel Synthesis' : 'Stage 3: Council Verdict & Synthesis'}
                      </h3>
                      <div className="flex items-center space-x-3">
                        {!isDeliberating && (
                          <button
                            onClick={() => round.resolvedMode === 'quick_panel' ? runQuickPanelSynthesis(round.id) : regenerateSynthesis(round.id)}
                            className="text-amber-400/70 hover:text-amber-200 text-xs font-medium flex items-center gap-1 transition-colors"
                            title="Re-run synthesis using current stage outputs"
                          >
                            <RefreshCw size={13} />
                            <span>Re-synthesize</span>
                          </button>
                        )}
                        {round.synthesis.content && (
                          <>
                            <button
                              type="button"
                              onClick={() => speak(round.synthesis.content, `${round.id}-synthesis`)}
                              className={`transition-colors p-1.5 rounded hover:bg-amber-900/40 text-xs font-medium flex items-center gap-1 ${
                                speakingId === `${round.id}-synthesis` ? 'text-amber-300 bg-amber-950/80 animate-pulse' : 'text-amber-400/70 hover:text-amber-200'
                              }`}
                              title={speakingId === `${round.id}-synthesis` ? 'Stop reading' : 'Read synthesis aloud'}
                            >
                              {speakingId === `${round.id}-synthesis` ? <VolumeX size={13} /> : <Volume2 size={13} />}
                              <span>{speakingId === `${round.id}-synthesis` ? 'Stop' : 'Speak'}</span>
                            </button>
                            <button
                              onClick={() => handleCopy(`${round.id}-synthesis`, round.synthesis.content)}
                              className="text-amber-400/70 hover:text-amber-200 text-xs font-medium flex items-center gap-1 transition-colors"
                            >
                              {copiedId === `${round.id}-synthesis` ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                              {copiedId === `${round.id}-synthesis` ? 'Copied' : 'Copy Consensus'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {round.synthesis.status === 'error' ? (
                      <div className="mt-2 text-sm text-red-400 bg-red-950/50 p-4 rounded-lg border border-red-900/50 flex flex-col gap-3">
                        <span className="font-bold">⚠️ Synthesis Phase Error</span>
                        <span className="font-mono text-xs">{round.synthesis.error}</span>
                        <button
                          onClick={() => round.resolvedMode === 'quick_panel' ? runQuickPanelSynthesis(round.id) : regenerateSynthesis(round.id)}
                          disabled={isDeliberating}
                          className="self-start text-xs font-semibold px-4 py-2 bg-red-900 hover:bg-red-800 text-red-100 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          <RefreshCw size={14} /> Retry Synthesis
                        </button>
                      </div>
                    ) : round.synthesis.content ? (
                      <MessageMarkdown content={round.synthesis.content} />
                    ) : (
                      <ThinkingIndicator
                        stageLabel="Synthesis Phase"
                        personaName={synthesizer.name}
                        role="Consensus Builder"
                        model={synthesizer.model || settings.defaultModels['synthesizer']}
                        accentColor="amber"
                      />
                    )}
                  </div>
                )}

              {/* Phase 2: Blind Pro Side-by-Side Comparison Card */}
              {round.proComparisonData && (
                <CompareProCard
                  auditLogId={round.proComparisonData.auditLogId}
                  userQuery={round.userQuery}
                  proModelId={round.proComparisonData.proModelId}
                  councilContent={round.synthesis.content}
                  proContent={round.proComparisonData.proContent}
                  councilLatencyMs={round.proComparisonData.councilLatencyMs}
                  proLatencyMs={round.proComparisonData.proLatencyMs}
                  councilCost={round.proComparisonData.councilCost}
                  proCost={round.proComparisonData.proCost}
                  answerAIsCouncil={round.proComparisonData.answerAIsCouncil}
                />
              )}
              </>
            )}
            </div>
          );
        })}
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

      {/* Sticky Input Anchor */}
      <div className="sticky bottom-0 z-20 bg-[#f5f5f0]/95 backdrop-blur-md border-t border-slate-200/80 p-3 sm:p-4">
        <div className="max-w-4xl mx-auto space-y-2.5">
          {fileError && (
            <div className="text-xs text-red-400 bg-red-950/50 p-2 rounded-lg border border-red-800/50 flex items-center justify-between">
              <span>⚠️ {fileError}</span>
              <button type="button" onClick={() => setFileError(null)} className="text-red-400 hover:text-red-200">
                <X size={12} />
              </button>
            </div>
          )}

          {/* Mode Selector & Estimate Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 pb-1 text-xs">
            <div className="flex items-center gap-1 bg-white border border-slate-200 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => updateExecutionMode('auto')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-medium text-xs ${
                  settings.executionMode === 'auto'
                    ? 'bg-cyan-950 text-cyan-200 border border-cyan-700/60 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Automatically choose Quick Panel or Deep Council based on query context"
              >
                <Sparkles size={12} className="text-cyan-400" />
                <span>Auto Router</span>
              </button>
              <button
                type="button"
                onClick={() => updateExecutionMode('quick_panel')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-medium text-xs ${
                  settings.executionMode === 'quick_panel'
                    ? 'bg-amber-950 text-amber-200 border border-amber-700/60 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Concurrent independent answers with low token limits and manual synthesis"
              >
                <Zap size={12} className="text-amber-400" />
                <span>Quick Panel</span>
              </button>
              <button
                type="button"
                onClick={() => updateExecutionMode('deep_council')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-medium text-xs ${
                  settings.executionMode === 'deep_council'
                    ? 'bg-purple-950 text-purple-200 border border-purple-700/60 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Full 3-stage deliberation with peer review and consensus synthesis"
              >
                <Layers size={12} className="text-purple-400" />
                <span>Deep Council</span>
              </button>
            </div>

            {(() => {
              const textFiles = attachedFiles.filter(f => !f.type?.startsWith('image/'));
              const predicted = resolveExecutionMode(settings.executionMode || 'auto', query, textFiles);
              const activeCount = personas.filter((p) => p.enabled !== false).length;
              const estCalls = predicted === 'quick_panel' ? activeCount : (activeCount * 2 + 1);

              return (
                <div className="flex items-center gap-2 font-mono">
                  {settings.executionMode === 'auto' && (
                    <span className="text-[11px] px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center gap-1.5">
                      <span className="text-slate-500">Auto →</span>
                      {predicted === 'quick_panel' ? (
                        <span className="text-amber-300 font-semibold flex items-center gap-1">
                          <Zap size={11} /> Quick Panel
                        </span>
                      ) : (
                        <span className="text-purple-300 font-semibold flex items-center gap-1">
                          <Layers size={11} /> Deep Council
                        </span>
                      )}
                    </span>
                  )}

                  {predicted === 'deep_council' && (
                    <span className="text-[10px] px-2.5 py-1 rounded-lg bg-purple-950/40 border border-purple-800/40 text-purple-300 flex items-center gap-2">
                      <span>Calls: <strong>{estCalls}</strong></span>
                      <span>Cost: <strong className="text-emerald-400">$0.00</strong></span>
                      <span>Est. Time: <strong>~15-30s</strong></span>
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Quick Persona Toggle Bar */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-500 font-mono text-[11px] uppercase tracking-wider">
                Council ({personas.filter((p) => p.enabled !== false).length}/{personas.length}):
              </span>
              <button
                type="button"
                disabled={isDeliberating || personas.filter((p) => p.enabled !== false).length < 2}
                onClick={rotateRoleAssignments}
                className="px-2 py-0.5 rounded-md bg-white hover:bg-slate-100 border border-slate-200/80 text-slate-600 hover:text-cyan-300 text-[11px] font-mono flex items-center gap-1 transition-colors disabled:opacity-40"
                title="Rotate model assignments across active personas to ensure roles are independent from model capabilities"
              >
                <Shuffle size={11} className="text-cyan-400" />
                <span>Rotate Roles</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFallbackModalOpen(true)}
                className={`px-2 py-0.5 rounded-md border text-[11px] font-mono flex items-center gap-1 transition-colors ${
                  fallbackLogs.length > 0
                    ? 'bg-amber-950/60 border-amber-700/80 text-amber-300 hover:bg-amber-900/80'
                    : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'
                }`}
                title="View automatic fallback events audit log"
              >
                <ShieldAlert size={11} className={fallbackLogs.length > 0 ? 'text-amber-400' : 'text-slate-500'} />
                <span>Fallback Audit ({fallbackLogs.length})</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              {personas.map((p) => {
                const isEnabled = p.enabled !== false;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isDeliberating}
                    onClick={() => {
                      setPersonas(
                        personas.map((item) =>
                          item.id === p.id ? { ...item, enabled: !isEnabled } : item
                        )
                      );
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all shrink-0 ${
                      isEnabled
                        ? 'bg-white border-cyan-500/50 text-cyan-200 shadow-sm shadow-cyan-950/40'
                        : 'bg-white/60 border-slate-200 text-slate-500 line-through opacity-50 hover:opacity-80'
                    }`}
                    title={isEnabled ? `Disable ${p.name}` : `Enable ${p.name}`}
                  >
                    <span>{p.avatar}</span>
                    <span>{p.name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                  </button>
                );
              })}
            </div>
          </div>

          {personas.filter((p) => p.enabled !== false).length === 0 && (
            <div className="text-xs text-amber-300 bg-amber-950/50 border border-amber-800/60 px-3 py-1.5 rounded-lg flex items-center justify-between">
              <span>⚠️ All council personas are disabled. Enable at least one perspective to deliberate.</span>
              <button
                type="button"
                onClick={() => setPersonas(personas.map((p) => ({ ...p, enabled: true })))}
                className="underline font-semibold hover:text-amber-200 ml-2 shrink-0"
              >
                Enable All
              </button>
            </div>
          )}

          {/* File Attachment List */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {attachedFiles.map((file, fIdx) => (
                <div key={fIdx} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs shadow-sm relative group ${
                  file.unzippedResult
                    ? 'bg-purple-950/40 border-purple-500/40 text-purple-200'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}>
                  {file.type?.startsWith('image/') ? (
                    <img src={file.content} alt={file.name} className="w-4 h-4 object-cover rounded shrink-0" />
                  ) : file.unzippedResult ? (
                    <Archive size={13} className="text-purple-400 shrink-0" />
                  ) : (
                    <Paperclip size={12} className="text-cyan-400 shrink-0" />
                  )}
                  <span className="font-mono text-[11px] max-w-[150px] truncate">{file.name}</span>
                  {file.unzippedResult ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveZipResult(file.unzippedResult || null);
                        setIsZipModalOpen(true);
                      }}
                      className="text-[10px] bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 font-mono px-1.5 py-0.5 rounded transition-colors underline cursor-pointer"
                      title="Inspect extracted code files from zip archive"
                    >
                      {file.unzippedResult.extractedCodeFilesCount} code files
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-mono">({(file.size / 1024).toFixed(1)} KB)</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(fIdx)}
                    className="text-slate-500 hover:text-red-400 transition-colors p-0.5 ml-1 cursor-pointer"
                    title="Remove file"
                  >
                    <X size={12} />
                  </button>
                  {file.type?.startsWith('image/') && (
                    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50">
                      <img src={file.content} alt={file.name} className="max-w-[200px] max-h-[200px] object-contain rounded border border-slate-200 shadow-xl bg-[#f5f5f0]" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {(query.length > 0 || attachedFiles.length > 0) && (
            <div className="flex items-center justify-between px-1 text-[11px] font-mono text-emerald-400/90">
              <span>Prompt Input ({queryTokens.toLocaleString()} tokens): {formatCost(calculateCallCost(queryTokens, 0, 'google/gemini-2.0-flash-001'))}</span>
              <span>Accumulated Session Cost: {formatCost(sessionCostMetrics.totalCost)}</span>
            </div>
          )}
          <form 
            onSubmit={handleDeliberate} 
            className="flex items-end gap-2.5"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              accept=".txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.html,.css,.pdf,.zip,text/*,application/json,application/pdf,application/zip,application/x-zip-compressed,image/*,.png,.jpg,.jpeg,.webp,.gif,.heic,.svg"
              className="hidden"
            />
            <button
              type="button"
              disabled={isDeliberating}
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-cyan-400 transition-colors shrink-0 disabled:opacity-40"
              title="Upload context document or code file"
            >
              <Paperclip size={18} />
            </button>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (query.trim() || attachedFiles.length > 0) {
                    handleDeliberate(e as any);
                  }
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const target = e.currentTarget;
                  const start = target.selectionStart;
                  const end = target.selectionEnd;
                  const val = target.value;
                  setQuery(val.substring(0, start) + '  ' + val.substring(end));
                  setTimeout(() => {
                    target.selectionStart = target.selectionEnd = start + 2;
                  }, 0);
                }
              }}
              placeholder={
                rounds.length > 0
                  ? "Ask a follow-up question to the council..."
                  : "Submit a question or decision for council deliberation..."
              }
              rows={2}
              disabled={isDeliberating}
              className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 transition-colors disabled:opacity-50 resize-y min-h-[48px] max-h-[160px]"
            />
            {isDeliberating ? (
              <button
                type="button"
                onClick={handleStop}
                className="px-5 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-sm flex items-center gap-2 transition-colors shadow-lg shadow-red-950/50 shrink-0"
              >
                <Square size={16} /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!query.trim() && attachedFiles.length === 0}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-medium text-sm flex items-center gap-2 transition-all shadow-lg shadow-cyan-950/50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <Play size={16} /> Deliberate
              </button>
            )}
          </form>
        </div>
      </div>

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
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-white border border-cyan-500/60 text-cyan-200 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-mono flex items-center gap-2 animate-bounce">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  </div>
  );
};
