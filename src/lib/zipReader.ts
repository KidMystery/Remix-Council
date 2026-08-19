import type { ExtractedZipFile, ZipArchiveResult, ArchiveManifestEntry } from '../types';
import {
  MAX_EXTRACTED_FILES,
  MAX_FILE_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
  isIgnoredArchiveEntry,
  isLikelyCode,
  buildCodebaseContext,
} from './zipUtils';

export type { ExtractedZipFile, ZipArchiveResult, ArchiveManifestEntry } from '../types';
export { buildCodebaseContext } from './zipUtils';

const MAX_UNCOMPRESSED_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_COMPRESSION_RATIO = 200;

/**
 * Priority ordering for archive entries: config/entry points first,
 * then source, then tests, then tooling scripts, then everything else.
 */
export function getArchiveFilePriority(path: string): number {
  const normalized = path.toLowerCase().replace(/\\/g, '/');

  if (normalized === 'package.json' || normalized === 'pom.xml' || normalized === 'build.gradle' || normalized === 'cargo.toml' || normalized === 'go.mod' || normalized === 'requirements.txt') {
    return 0;
  }
  if (
    normalized === 'server.ts' ||
    normalized === 'server.js' ||
    normalized === 'main.ts' ||
    normalized === 'main.tsx' ||
    normalized === 'index.ts' ||
    normalized === 'index.tsx' ||
    normalized === 'app.ts' ||
    normalized === 'app.tsx' ||
    normalized === 'dockerfile' ||
    normalized === 'docker-compose.yml' ||
    normalized === 'docker-compose.yaml'
  ) {
    return 1;
  }
  if (
    normalized.startsWith('src/') &&
    (normalized.includes('test') || normalized.includes('spec') || normalized.includes('__tests__'))
  ) {
    return 3;
  }
  if (normalized.startsWith('src/')) {
    return 2;
  }
  if (
    normalized.includes('test') ||
    normalized.includes('spec') ||
    normalized.includes('__tests__')
  ) {
    return 3;
  }
  if (
    normalized.startsWith('scripts/') ||
    normalized.startsWith('tools/') ||
    normalized.startsWith('bin/')
  ) {
    return 4;
  }
  return 5;
}

interface RawArchiveEntry {
  path: string;
  content: string;
  size: number;
  isDirectory: boolean;
}

/**
 * Extracts readable code/text files from a ZIP or RAR archive with
 * zip-bomb, size, and context-ceiling guardrails.
 */
export async function extractCodeFromArchive(file: File): Promise<ZipArchiveResult> {
  const isRar = file.name.toLowerCase().endsWith('.rar') || file.type.includes('rar');
  const rawEntries = isRar ? await loadRarEntries(file) : await loadZipEntries(file);

  const manifest: ArchiveManifestEntry[] = [];
  const warnings: string[] = [];
  const files: ExtractedZipFile[] = [];
  let totalExtractedChars = 0;
  let skippedCount = 0;

  // Prioritize config/entry-point files first for context window efficiency.
  const ordered = [...rawEntries]
    .filter((e) => !e.isDirectory)
    .sort((a, b) => getArchiveFilePriority(a.path) - getArchiveFilePriority(b.path));

  for (const entry of ordered) {
    if (files.length >= MAX_EXTRACTED_FILES) {
      manifest.push({
        path: entry.path,
        status: 'omitted',
        reason: `Exceeded maximum extracted file count (${MAX_EXTRACTED_FILES}).`,
      });
      skippedCount++;
      continue;
    }

    if (isIgnoredArchiveEntry(entry.path)) {
      manifest.push({ path: entry.path, status: 'skipped', reason: 'Ignored directory or file type.' });
      skippedCount++;
      continue;
    }

    let content = entry.content;
    let truncated = false;

    if (content.length > MAX_FILE_CHARS) {
      content = content.slice(0, MAX_FILE_CHARS) + `\n\n... [TRUNCATED AFTER ${MAX_FILE_CHARS.toLocaleString()} CHARS]`;
      truncated = true;
      manifest.push({ path: entry.path, status: 'truncated', reason: 'Exceeded per-file character ceiling.', extractedChars: content.length });
    } else {
      manifest.push({ path: entry.path, status: 'extracted', extractedChars: content.length });
    }

    if (totalExtractedChars + content.length > MAX_TOTAL_CONTEXT_CHARS) {
      warnings.push(`Context ceiling reached: remaining lower-priority files were omitted.`);
      manifest.push({ path: entry.path, status: 'omitted', reason: 'Exceeded total context ceiling.' });
      skippedCount++;
      break;
    }

    totalExtractedChars += content.length;
    files.push({
      path: entry.path,
      name: entry.path.split('/').pop() || entry.path,
      size: content.length,
      content,
      isCode: isLikelyCode(entry.path, content),
      truncated,
    });
  }

  const extractedCodeFilesCount = files.length;

  const result: ZipArchiveResult = {
    filename: file.name,
    archiveType: isRar ? 'rar' : 'zip',
    files,
    totalFiles: rawEntries.filter((e) => !e.isDirectory).length,
    extractedCodeFilesCount,
    wasTruncated: totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS || files.length >= MAX_EXTRACTED_FILES,
    warnings,
    formattedContext: '',
  };

  // Build a formatted, ready-to-attach context block.
  result.formattedContext = buildCodebaseContext(
    file.name,
    rawEntries.filter((e) => !e.isDirectory).map((e) => e.path),
    files,
    manifest,
    warnings,
    result.wasTruncated,
    [],
    totalExtractedChars,
    result.archiveType as 'zip' | 'rar' | 'archive'
  );

  return result;
}

async function loadZipEntries(file: File): Promise<RawArchiveEntry[]> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  // ---- Safety checks (performed after load, before extraction) ----
  const entries = Object.keys(loadedZip.files);
  let totalUncompressed = 0;
  for (const p of entries) {
    const entry = loadedZip.files[p];
    if (!entry.dir) {
      totalUncompressed += (entry as any)._data?.uncompressedSize || 0;
    }
  }
  if (totalUncompressed > MAX_UNCOMPRESSED_SIZE_BYTES) {
    throw new Error('ZIP exceeds 50MB uncompressed safety limit.');
  }
  if (file.size > 0 && totalUncompressed / file.size > MAX_COMPRESSION_RATIO) {
    throw new Error('ZIP has an unsafe compression ratio (>200:1).');
  }

  const out: RawArchiveEntry[] = [];
  for (const p of entries) {
    const entry = loadedZip.files[p];
    if (entry.dir) continue;
    try {
      const content = await entry.async('string');
      out.push({
        path: p,
        content,
        size: content.length,
        isDirectory: false,
      });
    } catch (err: any) {
      console.warn(`[ZipReader] Could not read ${p} as text:`, err.message);
    }
  }
  return out;
}

async function loadRarEntries(file: File): Promise<RawArchiveEntry[]> {
  try {
    const { createExtractorFromData } = await import('node-unrar-js');
    const buffer = await file.arrayBuffer();
    const extractor = await createExtractorFromData({ data: new Uint8Array(buffer) });
    const extracted = extractor.extract();
    const arcFiles = Array.from(extracted.files || []);

    const out: RawArchiveEntry[] = [];
    for (const arcFile of arcFiles) {
      const header = arcFile.fileHeader;
      const path = header.name;
      if (header.flags?.directory) continue;
      if (!arcFile.extraction) continue;
      const content = new TextDecoder('utf-8').decode(arcFile.extraction);
      out.push({ path, content, size: content.length, isDirectory: false });
    }
    return out;
  } catch (err: any) {
    console.error('[ZipReader] RAR extraction failed:', err);
    throw new Error(`Could not read RAR archive: ${err?.message || 'Unknown RAR error'}`);
  }
}
