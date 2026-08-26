import { describe, it, expect } from 'vitest';
import { mergeNexusDocs, parseNexusDriveDoc, type PersistedMission } from '../nexusMission';

function mission(id: string, updatedAt: number, goal = id): PersistedMission {
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
  };
}

describe('Nexus Drive merge', () => {
  it('prefers the newer active mission so a phone sees the laptop run', () => {
    const merged = mergeNexusDocs(
      { version: 2, updatedAt: 10, mission: mission('home', 10, 'home goal'), archive: [] },
      { version: 2, updatedAt: 50, mission: mission('home', 50, 'later goal'), archive: [] }
    );
    expect(merged.mission?.goal).toBe('later goal');
    expect(merged.updatedAt).toBe(50);
  });

  it('a newer local reset clears the remote mission', () => {
    const merged = mergeNexusDocs(
      { version: 2, updatedAt: 80, mission: null, archive: [] },
      { version: 2, updatedAt: 50, mission: mission('old', 50), archive: [] }
    );
    expect(merged.mission).toBeNull();
  });

  it('unions archives by id and keeps the newest copy', () => {
    const merged = mergeNexusDocs(
      { version: 2, updatedAt: 1, mission: null, archive: [mission('a', 1, 'a1')] },
      { version: 2, updatedAt: 2, mission: null, archive: [mission('a', 9, 'a9'), mission('b', 2)] }
    );
    expect(merged.archive.map((m) => `${m.id}:${m.goal}`)).toEqual(['a:a9', 'b:b']);
  });

  it('parses a missing Drive file as empty, not a wipe signal', () => {
    expect(parseNexusDriveDoc(null)).toEqual({ version: 2, updatedAt: 0, mission: null, archive: [] });
  });
});
