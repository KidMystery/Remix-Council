import { describe, it, expect, beforeEach } from 'vitest';
import {
  _setDriveBlobIOForTests,
  collectEvidenceIds,
  collectMissionEvidenceIds,
  collectSessionEvidenceIds,
  evidenceBlobFileName,
  EVIDENCE_BLOB_PREFIX,
  hydrateAttachedBodies,
} from '../evidenceDrive';

describe('evidence blob Drive names', () => {
  it('names a hash-addressed appData file and rejects junk ids', () => {
    expect(evidenceBlobFileName('ev_aaaaaaaaaaaaaaaa')).toBe(
      `${EVIDENCE_BLOB_PREFIX}ev_aaaaaaaaaaaaaaaa.txt`
    );
    expect(evidenceBlobFileName('ev_aa/../x')).toBe(`${EVIDENCE_BLOB_PREFIX}ev_aax.txt`);
    expect(evidenceBlobFileName('')).toBe('');
  });

  it('collects ids from attachments and evidence without putting a body in the list', () => {
    expect(
      collectEvidenceIds(
        [{ evidenceId: 'ev_1' }, { evidenceId: 'ev_1' }, { evidenceId: undefined }],
        [{ id: 'ev_2' }, { id: 'ev_1' }]
      ).sort()
    ).toEqual(['ev_1', 'ev_2']);
  });

  it('walks a mission and a session without reading any body', () => {
    expect(
      collectMissionEvidenceIds({
        attachedFiles: [{ evidenceId: 'ev_csv' }],
        evidence: [{ id: 'ev_pdf' }],
        rounds: [{ attachedTextFiles: [{ evidenceId: 'ev_csv' }], evidence: [{ id: 'ev_zip' }] }],
      }).sort()
    ).toEqual(['ev_csv', 'ev_pdf', 'ev_zip']);
    expect(
      collectSessionEvidenceIds([
        { rounds: [{ attachedTextFiles: [{ evidenceId: 'ev_a' }], evidence: [{ id: 'ev_b' }] }] },
      ]).sort()
    ).toEqual(['ev_a', 'ev_b']);
  });
});

describe('hydrateAttachedBodies Drive fallback', () => {
  beforeEach(() => {
    _setDriveBlobIOForTests(null);
  });

  it('fills a missing local blob from Drive and does not invent a stub', async () => {
    const put: string[] = [];
    _setDriveBlobIOForTests({
      load: async (id) => (id === 'ev_csv' ? 'date,amt\n2026-01-01,40' : null),
      saveLocal: async (id, body) => {
        put.push(`${id}:${body.slice(0, 12)}`);
      },
      getLocal: async () => null,
    });
    const result = await hydrateAttachedBodies(
      [{ name: 'monarch.csv', content: '', evidenceId: 'ev_csv' }],
      [{ id: 'ev_csv' } as any]
    );
    expect(result.missingBlobIds).toEqual([]);
    expect(result.files[0].content).toContain('2026-01-01,40');
    expect(put).toEqual(['ev_csv:date,amt\n202']);
  });

  it('stays blob_missing when Drive does not have it either', async () => {
    _setDriveBlobIOForTests({
      load: async () => null,
      getLocal: async () => null,
    });
    const result = await hydrateAttachedBodies([{ name: 'gone.csv', content: '', evidenceId: 'ev_gone' }]);
    expect(result.missingBlobIds).toEqual(['ev_gone']);
    expect(result.files[0].content).toBe('');
    expect(result.driveUnread).toBe(false);
  });

  it('fails closed when Drive is unread — no invented stub', async () => {
    _setDriveBlobIOForTests({
      load: async () => {
        const err = new Error('Drive unread — local copy was not uploaded, so the other device is safe.');
        err.name = 'DriveUnreadError';
        throw err;
      },
      getLocal: async () => null,
    });
    const result = await hydrateAttachedBodies([{ name: 'cash.csv', content: '', evidenceId: 'ev_cash' }]);
    expect(result.driveUnread).toBe(true);
    expect(result.missingBlobIds).toEqual(['ev_cash']);
    expect(result.files[0].content).toBe('');
  });
});
