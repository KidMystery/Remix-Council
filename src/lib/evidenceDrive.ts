/**
 * Cross-device exhibit bodies.
 *
 * Session / Nexus / Oracle JSON still never carries a body. The extracted
 * UTF-8 text (not the original PDF bytes) lives in IndexedDB on this device
 * and, when signed in, as a hash-addressed file in Drive appDataFolder:
 *   council-blob-<evidenceId>.txt
 *
 * Fetch is on demand (open a mission / resume a round). Never slice.
 */

export const EVIDENCE_BLOB_PREFIX = 'council-blob-';

export function evidenceBlobFileName(id: string): string {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return '';
  return `${EVIDENCE_BLOB_PREFIX}${safe}.txt`;
}

export function collectEvidenceIds(
  files?: Array<{ evidenceId?: string } | null | undefined>,
  evidence?: Array<{ id?: string } | null | undefined>
): string[] {
  const ids = new Set<string>();
  for (const f of files || []) {
    if (f?.evidenceId) ids.add(f.evidenceId);
  }
  for (const e of evidence || []) {
    if (e?.id) ids.add(e.id);
  }
  return Array.from(ids);
}

type MissionLike = {
  attachedFiles?: Array<{ evidenceId?: string } | null | undefined>;
  evidence?: Array<{ id?: string } | null | undefined>;
  rounds?: Array<{
    attachedTextFiles?: Array<{ evidenceId?: string } | null | undefined>;
    evidence?: Array<{ id?: string } | null | undefined>;
  }>;
};

export function collectMissionEvidenceIds(mission: MissionLike | null | undefined): string[] {
  if (!mission) return [];
  const ids = new Set(collectEvidenceIds(mission.attachedFiles, mission.evidence));
  for (const r of mission.rounds || []) {
    for (const id of collectEvidenceIds(r.attachedTextFiles, r.evidence)) ids.add(id);
  }
  return Array.from(ids);
}

export function collectSessionEvidenceIds(
  sessions: Array<{
    rounds?: Array<{
      attachedTextFiles?: Array<{ evidenceId?: string } | null | undefined>;
      evidence?: Array<{ id?: string } | null | undefined>;
    }>;
  }>
): string[] {
  const ids = new Set<string>();
  for (const s of sessions || []) {
    for (const r of s.rounds || []) {
      for (const id of collectEvidenceIds(r.attachedTextFiles, r.evidence)) ids.add(id);
    }
  }
  return Array.from(ids);
}

export interface DriveBlobIO {
  load?(id: string): Promise<string | null>;
  save?(id: string, body: string): Promise<void>;
  getLocal?(id: string): Promise<string | null>;
  saveLocal?(id: string, body: string): Promise<void>;
}

let driveBlobIO: DriveBlobIO | null = null;

/** Test seam. Production never calls this. */
export function _setDriveBlobIOForTests(io: DriveBlobIO | null): void {
  driveBlobIO = io;
}

async function getLocalBlob(id: string): Promise<string | null> {
  if (driveBlobIO?.getLocal) return driveBlobIO.getLocal(id);
  const { getEvidenceBlob } = await import('./evidenceStore');
  return getEvidenceBlob(id);
}

async function saveLocalBlob(id: string, body: string): Promise<void> {
  if (driveBlobIO?.saveLocal) {
    await driveBlobIO.saveLocal(id, body);
    return;
  }
  const { putEvidenceBlob } = await import('./evidenceStore');
  await putEvidenceBlob(id, body);
}

async function loadBlobFromDrive(id: string): Promise<string | null> {
  if (driveBlobIO?.load) return driveBlobIO.load(id);
  const { isGoogleSignedIn, loadEvidenceBlobFromDrive } = await import('./drivePersistence');
  if (!isGoogleSignedIn()) return null;
  return loadEvidenceBlobFromDrive(id);
}

export async function hydrateAttachedBodies(
  files: Array<{ name: string; content: string; size?: number; type?: string; summary?: string; evidenceId?: string }>,
  evidence: Array<{ id?: string; name?: string }> = []
): Promise<{
  files: Array<{ name: string; content: string; size?: number; type?: string; summary?: string; evidenceId?: string }>;
  missingBlobIds: string[];
  driveUnread: boolean;
}> {
  const missingBlobIds: string[] = [];
  let driveUnread = false;
  const out: Array<{ name: string; content: string; size?: number; type?: string; summary?: string; evidenceId?: string }> = [];

  for (const f of files || []) {
    const id = f.evidenceId || evidence.find((e) => e.name === f.name)?.id;
    if (f.content && f.content.length > 0) {
      out.push(f);
      continue;
    }
    if (!id) {
      out.push(f);
      continue;
    }

    let body: string | null = await getLocalBlob(id).catch(() => null);
    if (body == null) {
      try {
        body = await loadBlobFromDrive(id);
        if (body != null) {
          await saveLocalBlob(id, body).catch((err) => {
            console.warn('[EvidenceDrive] Could not cache Drive blob locally:', id, err);
          });
        }
      } catch (err) {
        driveUnread = true;
        console.warn('[EvidenceDrive] Drive unread — exhibit body not hydrated:', id, err);
      }
    }

    if (body == null) {
      missingBlobIds.push(id);
      out.push(f);
    } else {
      out.push({ ...f, content: body, evidenceId: id });
    }
  }

  return { files: out, missingBlobIds, driveUnread };
}

export async function pushEvidenceBlobsToDrive(ids: string[]): Promise<void> {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (unique.length === 0) return;
  const { isGoogleSignedIn, saveEvidenceBlobToDrive } = await import('./drivePersistence');
  if (!isGoogleSignedIn()) return;
  const { getEvidenceBlob } = await import('./evidenceStore');
  for (const id of unique) {
    try {
      const body = await getEvidenceBlob(id);
      if (body) await saveEvidenceBlobToDrive(id, body);
    } catch (err) {
      console.warn('[EvidenceDrive] Could not push blob (local copy kept):', id, err);
    }
  }
}
