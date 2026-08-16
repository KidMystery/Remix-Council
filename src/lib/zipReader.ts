import JSZip from 'jszip';
import { ArchiveEntryStatus, ArchiveManifestEntry } from '../types';

export const MAX_EXTRACTED_FILES = 200;
export const MAX_FILE_CHARS = 150_000;
export const MAX_TOTAL_CONTEXT_CHARS = 750_000;

export interface ExtractedZipFile {
  path: string;
  name: string;
  size: number;
  content: string;
  isCode: boolean;
  truncated?: boolean;
}

export type ExtractedArchiveFile = ExtractedZipFile;

export interface ZipArchiveResult {
  filename: string;
  archiveType?: 'zip' | 'rar' | 'archive';
  totalFiles: number;
  extractedCodeFilesCount: number;
  fileTree: string[];
  manifest: ArchiveManifestEntry[];
  files: ExtractedZipFile[];
  formattedContext: string;
  warnings?: string[];
  wasTruncated?: boolean;
  isPartial?: boolean;
  totalExtractedChars?: number;
  contextCeiling?: number;
  omittedFiles?: string[];
}

export type ArchiveResult = ZipArchiveResult;

// Extensions considered source code or readable text
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'html', 'css', 'scss', 'less', 'sass',
  'py', 'java', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'kts',
  'md', 'markdown', 'txt', 'csv', 'yaml', 'yml', 'xml',
  'sql', 'sh', 'bash', 'zsh', 'env', 'example',
  'graphql', 'gql', 'proto', 'dockerfile', 'makefile', 'cmake', 'toml', 'ini',
  'vue', 'svelte', 'astro', 'prisma', 'diff', 'patch'
]);

// Binary extensions to skip
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'heic', 'svg',
  'pdf', 'zip', 'gz', 'tar', 'tgz', 'rar', '7z', 'bz2', 'xz',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'pyc', 'class',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'avi', 'mov', 'mkv'
]);

/**
 * Checks if an archive entry path should be skipped (build artifacts, dependencies, system files)
 */
export function isIgnoredArchiveEntry(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase().replace(/\\/g, '/');

  if (
    normalized.includes('__macosx/') ||
    normalized.includes('.ds_store') ||
    normalized.includes('.git/') ||
    normalized.includes('node_modules/') ||
    normalized.includes('dist/') ||
    normalized.includes('build/') ||
    normalized.includes('.next/') ||
    normalized.includes('.nuxt/') ||
    normalized.includes('.turbo/') ||
    normalized.includes('.cache/') ||
    normalized.includes('coverage/') ||
    normalized.includes('archive/scripts/') ||
    normalized.startsWith('archive/scripts/')
  ) {
    return true;
  }

  const filename = relativePath.split(/[/\\]/).pop()?.toLowerCase() || '';

  if (
    filename.startsWith('patch_') ||
    filename.startsWith('fix_') ||
    filename.endsWith('.patch')
  ) {
    return true;
  }

  // Skip lockfiles from primary code analysis to save token budget
  if (
    filename === 'package-lock.json' ||
    filename === 'yarn.lock' ||
    filename === 'pnpm-lock.yaml' ||
    filename === 'bun.lockb' ||
    filename === 'cargo.lock' ||
    filename === 'composer.lock' ||
    filename === 'gemfile.lock' ||
    filename.endsWith('.lock')
  ) {
    return true;
  }

  return false;
}

export const isIgnoredZipEntry = isIgnoredArchiveEntry;

/**
 * Priority scoring for codebase files.
 * Lower number = higher priority to be included in limited LLM context window.
 */
export function getArchiveFilePriority(relativePath: string): number {
  const norm = relativePath.toLowerCase().replace(/\\/g, '/');
  const filename = norm.split('/').pop() || norm;

  // 1. Manifests, package.json, README, deployment specs
  if (filename === 'package.json' || filename === 'readme.md' || filename === 'railway.json' || filename === 'firestore.rules') {
    return 1;
  }

  // 2. Main entry points
  if (
    norm === 'server.ts' || norm === 'src/server.ts' ||
    norm === 'src/main.tsx' || norm === 'src/index.tsx' ||
    norm === 'src/app.tsx' || norm === 'src/app.ts' ||
    norm === 'index.html'
  ) {
    return 2;
  }

  // 3. Types and schemas
  if (norm === 'src/types.ts' || norm.includes('/types') || norm.endsWith('.d.ts') || norm.includes('/schema')) {
    return 3;
  }

  // 4. Core config files
  if (
    filename === 'vite.config.ts' || filename === 'tsconfig.json' ||
    filename === 'tailwind.config.js' || filename === '.env.example'
  ) {
    return 4;
  }

  // 5. Core library / hooks / business logic
  if (norm.startsWith('src/lib/') || norm.startsWith('src/hooks/')) {
    return 5;
  }

  // 6. Components
  if (norm.startsWith('src/components/')) {
    return 6;
  }

  // 7. General src/ source code
  if (norm.startsWith('src/')) {
    return 7;
  }

  // 8. Maintained test suite
  if (norm.includes('__tests__') || norm.includes('.test.') || norm.includes('.spec.')) {
    return 8;
  }

  // 9. Root scripts and historical docs
  if (norm.startsWith('scripts/')) {
    return 9;
  }

  return 10;
}

/**
 * Extracts and parses code files from an uploaded .zip archive file using client-side JSZip
 */
export async function extractCodeFromZip(file: File): Promise<ZipArchiveResult> {
  try {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(file);

    const extractedFiles: ExtractedZipFile[] = [];
    const fileTree: string[] = [];
    const manifest: ArchiveManifestEntry[] = [];
    const omittedFiles: string[] = [];
    const warnings: string[] = [];

    const entries = Object.keys(loadedZip.files);

    const uncompressedSize = entries.reduce(
      (sum, path) => sum + ((loadedZip.files[path] as any)?._data?.uncompressedSize || 0),
      0
    );
    const compressedSize = file.size;

    if (uncompressedSize > 50_000_000) {
      throw new Error('Zip archive expands beyond the 50MB safety limit.');
    }

    if (compressedSize > 0 && uncompressedSize > 0 && (uncompressedSize / compressedSize) > 200) {
      throw new Error('Zip archive has an unsafe compression ratio.');
    }

    // Sort entries by prioritized relevance
    const nonDirEntries = entries.filter((path) => !loadedZip.files[path].dir);
    nonDirEntries.sort((a, b) => {
      const pA = getArchiveFilePriority(a);
      const pB = getArchiveFilePriority(b);
      if (pA !== pB) return pA - pB;
      return a.localeCompare(b);
    });

    let totalExtractedChars = 0;
    let fileCount = 0;
    let wasTruncated = false;
    let isPartial = false;

    // Enumerate every entry for complete manifest
    for (const relativePath of nonDirEntries) {
      fileTree.push(relativePath);
      const entry = loadedZip.files[relativePath];
      const filename = relativePath.split(/[/\\]/).pop() || relativePath;
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const entrySize = (entry as any)?._data?.uncompressedSize || 0;

      if (isIgnoredArchiveEntry(relativePath)) {
        manifest.push({
          path: relativePath,
          size: entrySize,
          type: ext,
          status: 'ignored',
          reason: 'Build artifact, package lockfile, or ignored pattern',
          extractedChars: 0,
        });
        continue;
      }

      if (BINARY_EXTENSIONS.has(ext)) {
        manifest.push({
          path: relativePath,
          size: entrySize,
          type: ext,
          status: 'binary',
          reason: 'Binary file skipped',
          extractedChars: 0,
        });
        continue;
      }

      // Check context budget
      if (fileCount >= MAX_EXTRACTED_FILES || totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS) {
        isPartial = true;
        omittedFiles.push(relativePath);
        manifest.push({
          path: relativePath,
          size: entrySize,
          type: ext,
          status: 'omitted',
          reason: totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS
            ? 'Total context ceiling reached'
            : 'Maximum extracted files ceiling reached',
          extractedChars: 0,
        });
        continue;
      }

      try {
        let content = await entry.async('string');

        if (!isTextContent(content)) {
          manifest.push({
            path: relativePath,
            size: entrySize,
            type: ext,
            status: 'binary',
            reason: 'Contains non-text binary data',
            extractedChars: 0,
          });
          continue;
        }

        let isFileTruncated = false;
        if (content.length > MAX_FILE_CHARS) {
          content = content.slice(0, MAX_FILE_CHARS) + `\n\n... [FILE TRUNCATED AFTER ${MAX_FILE_CHARS.toLocaleString()} CHARS]`;
          isFileTruncated = true;
          wasTruncated = true;
          isPartial = true;
          warnings.push(`File ${relativePath} truncated at ${MAX_FILE_CHARS.toLocaleString()} chars.`);
        }

        if (totalExtractedChars + content.length > MAX_TOTAL_CONTEXT_CHARS) {
          const remaining = MAX_TOTAL_CONTEXT_CHARS - totalExtractedChars;
          if (remaining > 300) {
            content = content.slice(0, remaining) + `\n\n... [TOTAL CONTEXT CEILING REACHED]`;
            extractedFiles.push({
              path: relativePath,
              name: filename,
              size: content.length,
              content,
              isCode: CODE_EXTENSIONS.has(ext) || isLikelyCode(filename, content),
              truncated: true,
            });
            totalExtractedChars += content.length;
            manifest.push({
              path: relativePath,
              size: entrySize,
              type: ext,
              status: 'truncated',
              reason: 'Partially included before reaching total context ceiling',
              extractedChars: content.length,
            });
          } else {
            omittedFiles.push(relativePath);
            manifest.push({
              path: relativePath,
              size: entrySize,
              type: ext,
              status: 'omitted',
              reason: 'Total context ceiling reached',
              extractedChars: 0,
            });
          }
          wasTruncated = true;
          isPartial = true;
          continue;
        }

        extractedFiles.push({
          path: relativePath,
          name: filename,
          size: content.length,
          content,
          isCode: CODE_EXTENSIONS.has(ext) || isLikelyCode(filename, content),
          truncated: isFileTruncated,
        });

        manifest.push({
          path: relativePath,
          size: entrySize,
          type: ext,
          status: isFileTruncated ? 'truncated' : 'included',
          extractedChars: content.length,
        });

        totalExtractedChars += content.length;
        fileCount++;
      } catch (err) {
        manifest.push({
          path: relativePath,
          size: entrySize,
          type: ext,
          status: 'skipped',
          reason: `Read error: ${(err as any)?.message || 'Unknown'}`,
          extractedChars: 0,
        });
      }
    }

    const formattedContext = buildCodebaseContext(
      file.name,
      fileTree,
      extractedFiles,
      manifest,
      warnings,
      isPartial,
      omittedFiles,
      totalExtractedChars,
      'zip'
    );

    return {
      filename: file.name,
      archiveType: 'zip',
      totalFiles: entries.length,
      extractedCodeFilesCount: extractedFiles.length,
      fileTree,
      manifest,
      files: extractedFiles,
      formattedContext,
      warnings,
      wasTruncated,
      isPartial,
      totalExtractedChars,
      contextCeiling: MAX_TOTAL_CONTEXT_CHARS,
      omittedFiles,
    };
  } catch (err: any) {
    console.warn('[ZipReader] Client extraction failed or fallback needed:', err);
    return extractViaServerEndpoint(file);
  }
}

export async function extractCodeFromRar(file: File): Promise<ZipArchiveResult> {
  return extractViaServerEndpoint(file);
}

async function extractViaServerEndpoint(file: File): Promise<ZipArchiveResult> {
  const arrayBuffer = await file.arrayBuffer();
  const base64Data = arrayBufferToBase64(arrayBuffer);

  const response = await fetch('/api/council/extract-archive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: file.name,
      dataBase64: base64Data,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Archive extraction failed: ${errorText || response.statusText}`);
  }

  const result: ZipArchiveResult = await response.json();
  return result;
}

export async function extractCodeFromArchive(file: File): Promise<ZipArchiveResult> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.zip') || file.type === 'application/zip' || file.type.includes('zip')) {
    return extractCodeFromZip(file);
  }
  return extractCodeFromRar(file);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
      context += `- ${m.path} [${m.status.toUpperCase()}${m.reason ? `: ${m.reason}` : ''}] (${m.extractedChars} chars)\n`;
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
