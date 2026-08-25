import { describe, it, expect } from 'vitest';
import type { Session, CouncilRound } from '../../types';
import {
  addTombstone,
  applyTombstones,
  isTombstoned,
  mergeTombstones,
} from '../syncContract';
import {
  mergeOracleThreads,
  mergeSessionDocs,
  mergeSessions,
  parseOracleDriveDoc,
  parseSessionDriveDoc,
} from '../drivePersistence';
import { LEGACY_TRUNCATION_MARKERS } from '../evidence';

function session(id: string, updatedAt: number, rounds: CouncilRound[] = []): Session {
  return {
    id,
    title: id,
    rounds,
    personas: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function round(id: string, extras: Partial<CouncilRound> = {}): CouncilRound {
  return {
    id,
    userQuery: 'q',
    timestamp: 1,
    deliberation: { stage1: {}, stage2: {} },
    synthesis: { content: '', status: 'idle' },
    ...extras,
  };
}

describe('tombstones', () => {
  it('keeps the later delete mark per id', () => {
    const merged = mergeTombstones(
      [{ id: 'a', deletedAt: 10 }],
      [{ id: 'a', deletedAt: 30 }, { id: 'b', deletedAt: 5 }]
    );
    expect(merged.find((t) => t.id === 'a')?.deletedAt).toBe(30);
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('a later edit undeletes; an older edit stays dead', () => {
    const stones = addTombstone([], 's1', 100);
    expect(isTombstoned('s1', 50, stones)).toBe(true);
    expect(isTombstoned('s1', 150, stones)).toBe(false);
    expect(applyTombstones([session('s1', 50), session('s2', 50)], stones).map((s) => s.id)).toEqual(['s2']);
  });
});

describe('merge-before-put (two devices)', () => {
  it('keeps a thread the stale writer never saw', () => {
    const phone = [session('old', 1), session('phone-new', 100)];
    const laptopStale = [session('old', 1)];
    const { merged } = mergeSessions(laptopStale, phone);
    expect(merged.map((s) => s.id).sort()).toEqual(['old', 'phone-new']);
  });

  it('delete on A beats an older copy on B', () => {
    const a = mergeSessionDocs(
      { version: 2, sessions: [], deleted: [{ id: 'gone', deletedAt: 200 }] },
      { version: 2, sessions: [session('gone', 50), session('keep', 50)], deleted: [] }
    );
    expect(a.sessions.map((s) => s.id)).toEqual(['keep']);
    expect(a.deleted.some((t) => t.id === 'gone')).toBe(true);
  });

  it('an edit newer than the delete undeletes', () => {
    const doc = mergeSessionDocs(
      { version: 2, sessions: [], deleted: [{ id: 'revived', deletedAt: 100 }] },
      { version: 2, sessions: [session('revived', 250)], deleted: [] }
    );
    expect(doc.sessions.map((s) => s.id)).toEqual(['revived']);
  });

  it('prefers exhibit identity over a long truncated synthesis', () => {
    const local = session('s', 10, [
      round('r1', {
        evidence: [
          {
            id: 'ev_aa',
            name: 'bill.pdf',
            mime: 'application/pdf',
            byteSize: 10,
            sha256: 'aa',
            extractor: 'pdf-text',
            extractorVersion: '1',
            coverage: { extractedChars: 10, byteSize: 10 },
            createdAt: 1,
            preview: 'x',
          },
        ],
        deliberation: {
          stage1: { skeptic: { personaId: 'skeptic', content: 'ok', status: 'completed' } },
          stage2: {},
        },
      }),
    ]);
    const drive = session('s', 10, [
      round('r1', {
        attachedTextFiles: [{ name: 'bill.pdf', content: `x\n${LEGACY_TRUNCATION_MARKERS[0]}` }],
        synthesis: { content: 'very long looking chair draft '.repeat(30), status: 'completed' },
      }),
    ]);
    const { merged } = mergeSessions([local], [drive]);
    const r = merged[0].rounds[0];
    expect(r.evidence?.length).toBe(1);
    expect(r.synthesis?.status).not.toBe('completed');
  });
});

describe('oracle merge + envelopes', () => {
  it('unions messages from both devices and honors thread tombstones', () => {
    const { merged, deleted } = mergeOracleThreads(
      [{ id: 't1', title: 'Hal', updatedAt: 10, messages: [{ id: 'm1', content: 'hi', timestamp: 1 }] }],
      [
        { id: 't1', title: 'Hal', updatedAt: 20, messages: [{ id: 'm2', content: 'there', timestamp: 2 }] },
        { id: 't2', title: 'gone', updatedAt: 5, messages: [] },
      ],
      [],
      [{ id: 't2', deletedAt: 50 }]
    );
    expect(merged.map((t: any) => t.id)).toEqual(['t1']);
    expect(merged[0].messages.map((m: any) => m.id).sort()).toEqual(['m1', 'm2']);
    expect(deleted.some((t) => t.id === 't2')).toBe(true);
  });

  it('reads a legacy Drive array as sessions with no tombstones', () => {
    const doc = parseSessionDriveDoc([session('legacy', 1)]);
    expect(doc.sessions[0].id).toBe('legacy');
    expect(doc.deleted).toEqual([]);
  });

  it('reads a v2 envelope', () => {
    const doc = parseOracleDriveDoc({
      version: 2,
      threads: [{ id: 't', messages: [] }],
      deleted: [{ id: 'x', deletedAt: 1 }],
      globalBible: { content: 'fact', updatedAt: 1 },
    });
    expect(doc.threads).toHaveLength(1);
    expect(doc.deleted).toHaveLength(1);
  });
});
