import type { ArchiveManifestEntry, ExtractedZipFile } from '../types';

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
