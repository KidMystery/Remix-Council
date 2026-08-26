import { describe, it, expect } from 'vitest';
import {
  deleteNexusMission,
  listNexusMissions,
  mergeNexusDocs,
  missionHasWork,
  openNexusMission,
  parkActiveMission,
  parseNexusDriveDoc,
  renameNexusMission,
  type PersistedMission,
} from '../nexusMission';

function mission(id: string, updatedAt: number, goal = id, extra: Partial<PersistedMission> = {}): PersistedMission {
  return {
    id,
    goal,
    presetId: 'deep_council',
    maxIterations: 3,
    currentIteration: 1,
    status: 'converged',
    rounds: [],
    consensusMetrics: [],
    estimatedCost: 0,
    updatedAt,
    ...extra,
  };
}

describe('Nexus Drive merge', () => {
  it('prefers the newer active mission so a phone sees the laptop run', () => {
    const merged = mergeNexusDocs(
      { version: 2, updatedAt: 10, mission: mission('home', 10, 'home goal'), archive: [], deleted: [] },
      { version: 2, updatedAt: 50, mission: mission('home', 50, 'later goal'), archive: [], deleted: [] }
    );
    expect(merged.mission?.goal).toBe('later goal');
    expect(merged.updatedAt).toBe(50);
  });

  it('a newer local reset clears the remote mission', () => {
    const merged = mergeNexusDocs(
      { version: 2, updatedAt: 80, mission: null, archive: [], deleted: [] },
      { version: 2, updatedAt: 50, mission: mission('old', 50), archive: [], deleted: [] }
    );
    expect(merged.mission).toBeNull();
  });

  it('unions archives by id and keeps the newest copy', () => {
    const merged = mergeNexusDocs(
      { version: 2, updatedAt: 1, mission: null, archive: [mission('a', 1, 'a1')], deleted: [] },
      { version: 2, updatedAt: 2, mission: null, archive: [mission('a', 9, 'a9'), mission('b', 2)], deleted: [] }
    );
    expect(merged.archive.map((m) => `${m.id}:${m.goal}`)).toEqual(['a:a9', 'b:b']);
  });

  it('parses a missing Drive file as empty, not a wipe signal', () => {
    expect(parseNexusDriveDoc(null)).toEqual({
      version: 2,
      updatedAt: 0,
      mission: null,
      archive: [],
      deleted: [],
    });
  });

  it('keeps parentMissionId so a follow-up stays a child, not a overwrite', () => {
    const merged = mergeNexusDocs(
      {
        version: 2,
        updatedAt: 20,
        mission: mission('child', 20, 'what if rent is 4k', { parentMissionId: 'cash' }),
        archive: [mission('cash', 10, 'cashflow')],
        deleted: [],
      },
      { version: 2, updatedAt: 10, mission: mission('cash', 10, 'cashflow'), archive: [], deleted: [] }
    );
    expect(merged.mission?.id).toBe('child');
    expect(merged.mission?.parentMissionId).toBe('cash');
    expect(merged.archive.map((m) => m.id)).toContain('cash');
  });

  it('delete on one device stays gone after merge', () => {
    const merged = mergeNexusDocs(
      { version: 2, updatedAt: 80, mission: null, archive: [], deleted: [{ id: 'gone', deletedAt: 80 }] },
      { version: 2, updatedAt: 50, mission: mission('gone', 50), archive: [mission('gone', 50)], deleted: [] }
    );
    expect(merged.mission).toBeNull();
    expect(merged.archive.map((m) => m.id)).not.toContain('gone');
    expect(merged.deleted.some((t) => t.id === 'gone')).toBe(true);
  });
});

describe('Nexus mission list', () => {
  it('does not treat a blank draft as work worth parking', () => {
    expect(missionHasWork(mission('blank', 1, '', { status: 'idle', currentIteration: 0 }))).toBe(false);
    expect(missionHasWork(mission('cash', 1, 'cashflow plan'))).toBe(true);
  });

  it('lists the live mission plus archive without duplicating the active id', () => {
    const listed = listNexusMissions(mission('live', 20, 'now'), [
      mission('live', 5, 'stale copy'),
      mission('old', 10, 'last night'),
    ]);
    expect(listed.map((m) => `${m.id}:${m.goal}`)).toEqual(['live:now', 'old:last night']);
  });

  it('follow-up parks the parent so last night stays clickable', () => {
    const parent = mission('cash', 10, 'cashflow');
    const archive = parkActiveMission(parent, []);
    expect(archive.map((m) => m.id)).toEqual(['cash']);
    const child = mission('rent', 20, 'what if rent is 4k', { parentMissionId: 'cash' });
    const listed = listNexusMissions(child, archive);
    expect(listed.map((m) => m.id)).toEqual(['rent', 'cash']);
    expect(listed[0].parentMissionId).toBe('cash');
  });

  it('opening last night parks the live follow-up instead of eating it', () => {
    const { active, archive } = openNexusMission(
      'cash',
      mission('rent', 20, 'what if rent is 4k', { parentMissionId: 'cash' }),
      [mission('cash', 10, 'cashflow')]
    );
    expect(active?.id).toBe('cash');
    expect(archive.map((m) => m.id)).toEqual(['rent']);
    expect(archive[0].parentMissionId).toBe('cash');
  });

  it('rename updates the live title', () => {
    const { active } = renameNexusMission('cash', 'Monday cashflow', mission('cash', 1, 'cashflow'), []);
    expect(active?.title).toBe('Monday cashflow');
  });

  it('delete tombstones the id and clears it if it was live', () => {
    const result = deleteNexusMission('cash', mission('cash', 1), [mission('old', 1)], []);
    expect(result.active).toBeNull();
    expect(result.archive.map((m) => m.id)).toEqual(['old']);
    expect(result.deleted.some((t) => t.id === 'cash')).toBe(true);
  });
});
