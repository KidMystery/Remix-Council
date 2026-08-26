/**
 * Nexus mission shape + merge. Drive and IndexedDB share this.
 * Exhibit bodies are never in this document — metadata + verdicts only.
 *
 * Missions are threads: one active slot, an archive list, follow-ups as
 * child ids with parentMissionId. Delete uses tombstones so the other
 * device does not resurrect a job you threw away.
 */

import type { AttachedTextFile, ConsensusMetric, CouncilRound, EvidenceRecord } from '../types';
import { stripRoundBodies } from './evidence';
import {
  addTombstone,
  applyTombstones,
  isTombstoned,
  mergeTombstones,
  type Tombstone,
} from './syncContract';

export type { Tombstone };

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
  /** Follow-up of this archived mission id. */
  parentMissionId?: string;
  /** Prior consensus carried into a follow-up. Never an exhibit body. */
  followUpContext?: string | null;
}

export interface NexusDriveDoc {
  version: 2;
  updatedAt: number;
  mission: PersistedMission | null;
  archive: PersistedMission[];
  deleted: Tombstone[];
}

export function isPersistedMission(raw: unknown): raw is PersistedMission {
  return Boolean(raw && typeof raw === 'object' && Array.isArray((raw as PersistedMission).rounds));
}

export function sanitizeMissionForStorage(mission: PersistedMission): PersistedMission {
  const followUp = (mission.followUpContext || '').trim();
  return {
    ...mission,
    attachedFiles: (mission.attachedFiles || []).map((f) => ({ ...f, content: '' })),
    rounds: (mission.rounds || []).map((r) => stripRoundBodies(r)),
    followUpContext: followUp ? followUp.slice(0, 6000) : mission.followUpContext ?? null,
  };
}

export function parseNexusDriveDoc(raw: unknown): NexusDriveDoc {
  if (!raw || typeof raw !== 'object') {
    return { version: 2, updatedAt: 0, mission: null, archive: [], deleted: [] };
  }
  const doc = raw as Partial<NexusDriveDoc>;
  const archive = Array.isArray(doc.archive) ? doc.archive.filter(isPersistedMission) : [];
  const deleted = Array.isArray(doc.deleted) ? mergeTombstones(doc.deleted) : [];
  return {
    version: 2,
    updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : 0,
    mission: isPersistedMission(doc.mission) ? doc.mission : null,
    archive,
    deleted,
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
 * Tombstones drop a mission unless a later edit undeletes it.
 */
export function mergeNexusDocs(local: NexusDriveDoc, remote: NexusDriveDoc): NexusDriveDoc {
  const deleted = mergeTombstones(local.deleted, remote.deleted);
  const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  let mission: PersistedMission | null;
  if (local.mission === null && localNewer && (local.updatedAt || 0) > 0) {
    mission = null;
  } else {
    mission = preferMission(local.mission, remote.mission);
  }
  if (mission && isTombstoned(mission.id, mission.updatedAt, deleted)) {
    mission = null;
  }
  return {
    version: 2,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    mission: mission ? sanitizeMissionForStorage(mission) : null,
    archive: applyTombstones(mergeNexusArchives(local.archive || [], remote.archive || []), deleted),
    deleted,
  };
}

export function missionHasWork(m: PersistedMission | null | undefined): boolean {
  if (!m) return false;
  if ((m.rounds || []).length > 0) return true;
  if ((m.goal || '').trim()) return true;
  if ((m.attachedFiles || []).some((f) => f?.name)) return true;
  if (m.serverJobId) return true;
  if ((m.followUpContext || '').trim()) return true;
  return false;
}

/** Active first if present, then archive, unique by id, newest first. */
export function listNexusMissions(
  active: PersistedMission | null,
  archive: PersistedMission[]
): PersistedMission[] {
  const map = new Map<string, PersistedMission>();
  for (const m of archive) {
    if (!m?.id) continue;
    map.set(m.id, sanitizeMissionForStorage(m));
  }
  if (active?.id) map.set(active.id, sanitizeMissionForStorage(active));
  return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Park the live job into the archive. Empty drafts are not kept. */
export function parkActiveMission(
  active: PersistedMission | null,
  archive: PersistedMission[]
): PersistedMission[] {
  if (!active?.id || !missionHasWork(active)) return mergeNexusArchives(archive, []);
  return mergeNexusArchives([sanitizeMissionForStorage(active)], archive);
}

/** Open an archived (or already-active) mission. Parks the current job first. */
export function openNexusMission(
  id: string,
  active: PersistedMission | null,
  archive: PersistedMission[]
): { active: PersistedMission | null; archive: PersistedMission[] } {
  if (!id) return { active, archive };
  if (active?.id === id) return { active, archive };
  const found = archive.find((m) => m.id === id);
  if (!found) return { active, archive };
  const parked = parkActiveMission(active, archive).filter((m) => m.id !== id);
  return { active: found, archive: parked };
}

export function deleteNexusMission(
  id: string,
  active: PersistedMission | null,
  archive: PersistedMission[],
  deleted: Tombstone[] = []
): { active: PersistedMission | null; archive: PersistedMission[]; deleted: Tombstone[] } {
  const stones = addTombstone(deleted, id);
  const nextActive = active?.id === id ? null : active;
  return {
    active: nextActive && !isTombstoned(nextActive.id, nextActive.updatedAt, stones) ? nextActive : null,
    archive: applyTombstones(
      archive.filter((m) => m.id !== id),
      stones
    ),
    deleted: stones,
  };
}

export function renameNexusMission(
  id: string,
  title: string,
  active: PersistedMission | null,
  archive: PersistedMission[]
): { active: PersistedMission | null; archive: PersistedMission[] } {
  const clean = title.trim();
  if (!id || !clean) return { active, archive };
  const now = Date.now();
  const nextActive = active?.id === id ? { ...active, title: clean, updatedAt: now } : active;
  const nextArchive = archive.map((m) => (m.id === id ? { ...m, title: clean, updatedAt: now } : m));
  return { active: nextActive, archive: nextArchive };
}
