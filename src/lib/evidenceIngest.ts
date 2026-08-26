/**
 * Turn a user File into an EvidenceRecord + in-memory body.
 * Failures are recorded on the exhibit (extractor: 'failed') — we never
 * invent a truncated stub so Resume cannot pretend the file was read.
 *
 * Local cache is IndexedDB. When signed in, extracted UTF-8 is also a
 * hash-addressed Drive appData file. Session JSON still never carries a body.
 */

import type { AttachedTextFile, EvidenceRecord } from '../types';
import { makeEvidenceRecord, sha256Hex } from './evidence';
import { putEvidenceBlob } from './evidenceStore';
import { pushEvidenceBlobsToDrive } from './evidenceDrive';
import { extractPdfEvidence } from './pdfUtils';
import { extractCodeFromArchive } from './zipReader';

export { hydrateAttachedBodies, _setDriveBlobIOForTests } from './evidenceDrive';
export type { DriveBlobIO } from './evidenceDrive';

export interface IngestedFile {
  evidence: EvidenceRecord;
  attached: AttachedTextFile;
  /** Full extracted text for this live session. Not written to session JSON. */
  body: string;
}

function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.tar') || lower.endsWith('.gz');
}

function scheduleDrivePush(id: string): void {
  void pushEvidenceBlobsToDrive([id]).catch((err) => {
    console.warn('[EvidenceIngest] Drive blob push failed (local copy kept):', id, err);
  });
}

export async function ingestFile(file: File): Promise<IngestedFile> {
  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const lower = file.name.toLowerCase();

  let extractor: EvidenceRecord['extractor'] = 'utf8';
  let body = '';
  let pagesTotal: number | undefined;
  let pagesWithText: number | undefined;
  let filesInArchive: number | undefined;
  let filesExtracted: number | undefined;
  let failDetail: string | undefined;

  try {
    if (isArchiveName(file.name)) {
      extractor = 'zip-code';
      const result = await extractCodeFromArchive(file);
      body = result.formattedContext || '';
      filesInArchive = result.totalFiles;
      filesExtracted = result.extractedCodeFilesCount;
    } else if (lower.endsWith('.pdf')) {
      extractor = 'pdf-text';
      const pdf = await extractPdfEvidence(file);
      body = pdf.text || '';
      pagesTotal = pdf.pagesTotal;
      pagesWithText = pdf.pagesWithText;
    } else {
      extractor = 'utf8';
      body = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  } catch (err: any) {
    extractor = 'failed';
    failDetail = err?.message || String(err);
    body = '';
  }

  const evidence = makeEvidenceRecord({
    sha256,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    byteSize: file.size,
    extractor,
    coverage: {
      extractedChars: body.length,
      pagesTotal,
      pagesWithText,
      filesInArchive,
      filesExtracted,
    },
    body,
    failDetail,
  });

  if (extractor !== 'failed') {
    try {
      await putEvidenceBlob(evidence.id, body);
      scheduleDrivePush(evidence.id);
    } catch (err: any) {
      // Quota / private mode: do not keep a silent stub. Surface as failed exhibit.
      evidence.extractor = 'failed';
      evidence.failDetail = err?.message || 'Could not store the extracted body on this device.';
      evidence.coverage = { ...evidence.coverage, extractedChars: 0 };
      return {
        evidence,
        body: '',
        attached: {
          name: file.name,
          content: '',
          size: file.size,
          type: file.type || 'application/octet-stream',
          evidenceId: evidence.id,
        },
      };
    }
  }

  return {
    evidence,
    body,
    attached: {
      name: file.name,
      content: body,
      size: file.size,
      type: isArchiveName(file.name) ? (lower.endsWith('.rar') ? 'rar' : 'zip') : lower.endsWith('.pdf') ? 'pdf' : file.type || 'text/plain',
      evidenceId: evidence.id,
    },
  };
}
