import type { ArchiveManifestEntry, AttachedTextFile, ExtractedZipFile, ZipArchiveResult } from '../types';

export const MAX_EXTRACTED_FILES = 200;
export const MAX_FILE_CHARS = 150_000;
export const MAX_TOTAL_CONTEXT_CHARS = 750_000;

export const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.cache', 'venv', '.venv', '__pycache__'
]);

export const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.mp4', '.webm', '.pdf', '.docx', '.xlsx', '.sqlite', '.db', '.class', '.jar', '.war', '.pyc', '.so', '.dll', '.dylib', '.exe', '.bin', '.tar', '.gz', '.7z'
]);

export const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.kt', '.sql', '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.md', '.sh', '.xml', '.toml'
]);

export function isIgnoredArchiveEntry(path: string): boolean {
  if (path.startsWith('__MACOSX/') || path.includes('/.DS_Store')) return true;
  const parts = path.split('/');
  for (const part of parts) {
    if (IGNORED_DIRECTORIES.has(part)) return true;
  }
  const lastDot = path.lastIndexOf('.');
  if (lastDot !== -1 && lastDot > path.lastIndexOf('/')) {
    const ext = path.substring(lastDot).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

export function isTextContent(str: string): boolean {
  if (!str) return true;
  const sample = str.slice(0, 1000);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nullCount++;
  }
  return nullCount === 0;
}

export function isLikelyCode(filename: string, content: string): boolean {
  const lowerName = filename.toLowerCase();
  if (
    lowerName === 'dockerfile' ||
    lowerName === 'makefile' ||
    lowerName.startsWith('.env') ||
    lowerName === 'procfile' ||
    lowerName === 'cmakelists.txt' ||
    lowerName === 'railway.json' ||
    lowerName === 'firestore.rules'
  ) {
    return true;
  }
  return (
    content.includes('import ') ||
    content.includes('export ') ||
    content.includes('function ') ||
    content.includes('const ') ||
    content.includes('class ') ||
    content.includes('def ') ||
    content.includes('package ') ||
    content.includes('#include')
  );
}

export function buildCodebaseContext(
  archiveName: string,
  fileTree: string[],
  files: ExtractedZipFile[],
  manifest: ArchiveManifestEntry[] = [],
  warnings: string[] = [],
  isPartial: boolean = false,
  omittedFiles: string[] = [],
  totalExtractedChars: number = 0,
  archiveType: 'zip' | 'rar' | 'archive' = 'archive'
): string {
  const label = archiveType.toUpperCase();
  let context = `================================================================================\n`;
  context += `ATTACHED ${label} CODEBASE ARCHIVE: ${archiveName}\n`;
  context += `Extracted ${files.length} prioritized source & schema files (${totalExtractedChars.toLocaleString()} characters)\n`;

  if (isPartial) {
    context += `[CODEBASE EXTRACTION NOTICE: PARTIAL CONTEXT - This archive exceeded the context ceiling of ${MAX_TOTAL_CONTEXT_CHARS.toLocaleString()} characters. Critical entry points, schemas, and prioritized runtime files are provided in full below. ${omittedFiles.length} lower-priority file(s) were omitted. Check the manifest below.]\n`;
  } else {
    context += `[CODEBASE EXTRACTION NOTICE: COMPLETE CONTEXT - All ${files.length} readable text & code files from this archive have been decompressed and provided in full below as plain text. You have complete direct access to inspect and cite every file, function, and line.]\n`;
  }

  if (warnings.length > 0) {
    context += `ATTACHMENT NOTICES:\n`;
    warnings.forEach((w) => {
      context += `- ${w}\n`;
    });
  }
  context += `================================================================================\n\n`;

  context += `[COMPLETE ARCHIVE MANIFEST: ${manifest.length || fileTree.length} total entries]\n`;
  if (manifest.length > 0) {
    manifest.forEach((m) => {
      context += `- ${m.path} [${m.status.toUpperCase()}${m.reason ? ': ' + m.reason : ''}] (${m.extractedChars} chars)\n`;
    });
  } else {
    fileTree.forEach((path) => {
      context += `- ${path}\n`;
    });
  }
  context += `\n`;

  context += `[PRIORITIZED FILE CONTENTS]\n`;
  files.forEach((file) => {
    context += `\n--------------------------------------------------------------------------------\n`;
    context += `FILE: ${file.path} (${file.size} chars)${file.truncated ? ' [TRUNCATED]' : ''}\n`;
    context += `--------------------------------------------------------------------------------\n`;
    context += file.content + `\n`;
  });

  context += `\n================================================================================\n`;
  context += `END OF ${label} CODEBASE ARCHIVE: ${archiveName}\n`;
  context += `================================================================================\n`;

  return context;
}

const FILE_SPLIT = /\n-{20,}\nFILE: /;

/** Rebuild the per-file list from a formatted archive dump (after hydrate). */
export function parseCodebaseContext(formatted: string): ExtractedZipFile[] {
  if (!formatted) return [];
  const parts = formatted.split(FILE_SPLIT);
  if (parts.length < 2) return [];
  const files: ExtractedZipFile[] = [];
  for (let i = 1; i < parts.length; i++) {
    const m = parts[i].match(/^(.+?) \((\d+) chars\)( \[TRUNCATED\])?\n-{20,}\n([\s\S]*)$/);
    if (!m) continue;
    const content = (m[4] || '')
      .replace(/\n={10,}[\s\S]*$/, '')
      .replace(/\n$/, '');
    files.push({
      path: m[1],
      name: m[1].split('/').pop() || m[1],
      size: content.length,
      content,
      isCode: true,
      truncated: Boolean(m[3]),
    });
  }
  return files;
}

export function isArchiveAttachment(file: Pick<AttachedTextFile, 'name' | 'type'>): boolean {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return type === 'zip' || type === 'rar' || name.endsWith('.zip') || name.endsWith('.rar');
}

/**
 * Structured inspect payload for the zip modal. Prefers FILE: sections in the
 * dump; otherwise shows the dump as one file so the eye still works after hydrate.
 */
export function zipResultFromAttached(file: AttachedTextFile): ZipArchiveResult | null {
  if (!isArchiveAttachment(file)) return null;
  const name = file.name || 'archive.zip';
  const archiveType: 'zip' | 'rar' =
    file.type === 'rar' || name.toLowerCase().endsWith('.rar') ? 'rar' : 'zip';
  const parsed = parseCodebaseContext(file.content || '');
  const files =
    parsed.length > 0
      ? parsed
      : file.content
        ? [
            {
              path: name,
              name: name.split('/').pop() || name,
              size: file.content.length,
              content: file.content,
              isCode: true,
            },
          ]
        : [];
  if (files.length === 0) return null;
  return {
    filename: name,
    archiveType,
    files,
    totalFiles: files.length,
    extractedCodeFilesCount: files.length,
    wasTruncated: (file.content || '').includes('PARTIAL CONTEXT'),
    warnings: [],
    formattedContext: file.content || '',
  };
}

export function archivesFromFiles(files: AttachedTextFile[]): Record<string, ZipArchiveResult> {
  const out: Record<string, ZipArchiveResult> = {};
  for (const f of files) {
    const z = zipResultFromAttached(f);
    if (z) out[f.name] = z;
  }
  return out;
}
