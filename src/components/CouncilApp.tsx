import React, { useState, useEffect } from 'react';
import { useSessionManager } from '../hooks/useSessionManager';
import { fetchCouncilModels } from '../lib/openrouter';
import type { CouncilPersona, RawOpenRouterModel, CostCeilingConfig } from '../types';
import { CouncilHeader, type AppViewMode } from './council/CouncilHeader';
import { CouncilChamber } from './CouncilChamber';
import { NexusLabView } from './NexusLabView';
import { CouncilSettingsModal } from './CouncilSettingsModal';

const DEFAULT_PERSONAS: CouncilPersona[] = [
  {
    id: 'skeptic',
    name: 'The Critical Skeptic',
    role: 'Risk Analysis & Vulnerability Auditing',
    systemPrompt: 'You are the Council Skeptic. Your goal is to rigorously challenge assumptions, identify single points of failure, unearth edge-case risks, and demand verifiable proof.',
    model: 'google/gemini-2.0-flash-exp:free',
    enabled: true,
  },
  {
    id: 'architect',
    name: 'Lead Systems Architect',
    role: 'Structural Scalability & Systems Design',
    systemPrompt: 'You are the Lead Systems Architect. You design clean, decoupled, high-performance architectures, focusing on concrete specifications, state invariants, and execution trade-offs.',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    enabled: true,
  },
  {
    id: 'synthesizer',
    name: 'Executive Strategist',
    role: 'Holistic Synthesis & Strategic Action',
    systemPrompt: 'You are the Executive Strategist. You balance engineering constraints with business value, synthesizing diverse viewpoints into decisive, actionable consensus verdicts.',
    model: 'qwen/qwen-2.5-72b-instruct:free',
    enabled: true,
  },
];

export const CouncilApp: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const initialView: AppViewMode = urlParams.get('view') === 'nexus' ? 'nexus' : 'chamber';

  const [view, setView] = useState<AppViewMode>(initialView);
  const [catalog, setCatalog] = useState<RawOpenRouterModel[]>([]);
  const [personas, setPersonas] = useState<CouncilPersona[]>(DEFAULT_PERSONAS);
  const [activePresetId, setActivePresetId] = useState<string>('fast_and_free');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // User-defined cost ceilings
  const [costCeiling, setCostCeiling] = useState<CostCeilingConfig>({
    maxSpendPerMissionDollars: 2.0,
    requireApprovalAboveDollars: 0.15,
    strictHardStop: true,
  });

  const {
    sessions,
    activeSession,
    activeSessionId,
    updateRoundInSession,
    completeAndFlushRound,
  } = useSessionManager();

  useEffect(() => {
    fetchCouncilModels()
      .then((models) => setCatalog(models))
      .catch((err) => console.warn('[CouncilApp] Catalog load notice:', err.message));
  }, []);

  const rounds = activeSession?.rounds || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <CouncilHeader
        currentView={view}
        onViewChange={(newView) => setView(newView)}
        sessionTitle={activeSession?.title}
        activePresetName={activePresetId === 'fast_and_free' ? 'Fast & Free' : 'Deep Council'}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <main className="flex-1 w-full">
        {view === 'chamber' ? (
          <CouncilChamber
            personas={personas}
            activePresetId={activePresetId}
            rounds={rounds}
            activeSessionId={activeSessionId}
            onUpdateRound={updateRoundInSession}
            onCompleteRound={completeAndFlushRound}
          />
        ) : (
          <NexusLabView
            personas={personas}
            catalog={catalog}
            onCompleteRound={completeAndFlushRound}
            activeSessionId={activeSessionId}
            costCeiling={costCeiling}
          />
        )}
      </main>

      {/* Sleek Settings & Safeguards Modal */}
      <CouncilSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        personas={personas}
        onUpdatePersonas={setPersonas}
        costCeiling={costCeiling}
        onUpdateCostCeiling={setCostCeiling}
      />
    </div>
  );
};
