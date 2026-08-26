/**
 * Nexus mission shape + merge. Drive and IndexedDB share this.
 * Exhibit bodies are never in this document — metadata + verdicts only.
 */

import type { AttachedTextFile, ConsensusMetric, CouncilRound, EvidenceRecord } from '../types';
import { stripRoundBodies } from './evidence';

export interface PersistedMission {
  id: string;
  goal: string;
  title?: string;
  presetId: string;
  maxIterations: number;
  currentIteration: number;
  status: 'idle' | 'running' | 'paused' | 'converged' | 'max_reached' | 'awaiting_approval' | 'error';
  rounds: CouncilRound[];
  consensusMetrics: ConsensusMetric[];
  estimatedCost: number;
  attachedFiles?: AttachedTextFile[];
  evidence?: EvidenceRecord[];
  updatedAt: number;
  morningBrief?: string | null;
  nightShift?: { cycles: number; paceMinutes: number } | null;
  serverJobId?: string | null;
  executionMode?: string | null;
}

export interface NexusDriveDoc {
  version: 2;
  updatedAt: number;
  mission: PersistedMission | null;
  archive: PersistedMission[];
}

export function isPersistedMission(raw: unknown): raw is PersistedMission {
  return Boolean(raw && typeof raw === 'object' && Array.isArray((raw as PersistedMission).rounds));
}

export function sanitizeMissionForStorage(mission: PersistedMission): PersistedMission {
  return {
    ...mission,
    attachedFiles: (mission.attachedFiles || []).map((f) => ({ ...f, content: '' })),
    rounds: (mission.rounds || []).map((r) => stripRoundBodies(r)),
  };
}

export function parseNexusDriveDoc(raw: unknown): NexusDriveDoc {
  if (!raw || typeof raw !== 'object') {
    return { version: 2, updatedAt: 0, mission: null, archive: [] };
  }
  const doc = raw as Partial<NexusDriveDoc>;
  const archive = Array.isArray(doc.archive) ? doc.archive.filter(isPersistedMission) : [];
  return {
    version: 2,
    updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : 0,
    mission: isPersistedMission(doc.mission) ? doc.mission : null,
    archive,
  };
}

function preferMission(a: PersistedMission | null, b: PersistedMission | null): PersistedMission | null {
  if (!a) return b;
  if (!b) return a;
  if (a.id === b.id) {
    return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a;
  }
  return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a;
}

export function mergeNexusArchives(local: PersistedMission[], remote: PersistedMission[]): PersistedMission[] {
  const map = new Map<string, PersistedMission>();
  for (const m of [...local, ...remote]) {
    if (!m?.id) continue;
    const clean = sanitizeMissionForStorage(m);
    const prev = map.get(clean.id);
    if (!prev || (clean.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(clean.id, clean);
  }
  return Array.from(map.values())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 20);
}

/**
 * Newer envelope wins the active mission. A local reset (mission null with a
 * newer updatedAt) clears the remote mission so Reset on one device sticks.
 */
export function mergeNexusDocs(local: NexusDriveDoc, remote: NexusDriveDoc): NexusDriveDoc {
  const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  let mission: PersistedMission | null;
  if (local.mission === null && localNewer && (local.updatedAt || 0) > 0) {
    mission = null;
  } else {
    mission = preferMission(local.mission, remote.mission);
  }
  return {
    version: 2,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    mission: mission ? sanitizeMissionForStorage(mission) : null,
    archive: mergeNexusArchives(local.archive || [], remote.archive || []),
  };
}
