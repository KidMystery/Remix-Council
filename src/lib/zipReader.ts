import JSZip from 'jszip';

export const MAX_EXTRACTED_FILES = 150;
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
  files: ExtractedZipFile[];
  formattedContext: string;
  warnings?: string[];
  wasTruncated?: boolean;
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
  'vue', 'svelte', 'astro', 'prisma', 'graphql', 'diff', 'patch'
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
 * Checks if an archive entry path should be skipped (build artifacts, dependencies, lockfiles, system files)
 */
export function isIgnoredArchiveEntry(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase().replace(/\\/g, '/');

  // Skip directories and metadata
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
    normalized.includes('coverage/')
  ) {
    return true;
  }

  const filename = relativePath.split(/[/\\]/).pop()?.toLowerCase() || '';

  // Skip lockfiles
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
 * Extracts and parses code files from an uploaded .zip archive file using client-side JSZip
 */
export async function extractCodeFromZip(file: File): Promise<ZipArchiveResult> {
  try {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(file);

    const extractedFiles: ExtractedZipFile[] = [];
    const fileTree: string[] = [];
    const warnings: string[] = [];

    const entries = Object.keys(loadedZip.files);

    // Safety checks: uncompressed size ceiling (50MB) and zip-bomb ratio guard (>200x)
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

    let totalExtractedChars = 0;
    let fileCount = 0;
    let wasTruncated = false;

    for (const relativePath of entries) {
      const entry = loadedZip.files[relativePath];

      // Skip directories and system/build/lockfile metadata
      if (entry.dir || isIgnoredArchiveEntry(relativePath)) {
        continue;
      }

      fileTree.push(relativePath);

      // Abort if maximum extracted files limit is reached
      if (fileCount >= MAX_EXTRACTED_FILES) {
        warnings.push(`Extraction capped at ${MAX_EXTRACTED_FILES} files limit.`);
        wasTruncated = true;
        break;
      }

      // Abort if total context limit reached
      if (totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS) {
        warnings.push(`Total context limit of ${MAX_TOTAL_CONTEXT_CHARS.toLocaleString()} characters reached. Remaining files omitted.`);
        wasTruncated = true;
        break;
      }

      const filename = relativePath.split(/[/\\]/).pop() || relativePath;
      const ext = filename.split('.').pop()?.toLowerCase() || '';

      // Skip known binary extensions
      if (BINARY_EXTENSIONS.has(ext)) {
        continue;
      }

      try {
        // Read text content
        let content = await entry.async('string');

        // Check if text is valid (does not contain null bytes)
        if (isTextContent(content)) {
          let isFileTruncated = false;

          // Enforce per-file character limit
          if (content.length > MAX_FILE_CHARS) {
            content = content.slice(0, MAX_FILE_CHARS) + `\n\n... [FILE TRUNCATED AFTER ${MAX_FILE_CHARS.toLocaleString()} CHARS]`;
            isFileTruncated = true;
            wasTruncated = true;
            warnings.push(`File ${relativePath} truncated at ${MAX_FILE_CHARS.toLocaleString()} chars.`);
          }

          // Enforce total context character limit
          if (totalExtractedChars + content.length > MAX_TOTAL_CONTEXT_CHARS) {
            const remainingAllowed = MAX_TOTAL_CONTEXT_CHARS - totalExtractedChars;
            if (remainingAllowed > 200) {
              content = content.slice(0, remainingAllowed) + `\n\n... [TOTAL CONTEXT LIMIT OF ${MAX_TOTAL_CONTEXT_CHARS.toLocaleString()} CHARS REACHED]`;
              extractedFiles.push({
                path: relativePath,
                name: filename,
                size: content.length,
                content,
                isCode: CODE_EXTENSIONS.has(ext) || isLikelyCode(filename, content),
                truncated: true,
              });
              totalExtractedChars += content.length;
            }
            wasTruncated = true;
            warnings.push(`Total context limit of ${MAX_TOTAL_CONTEXT_CHARS.toLocaleString()} chars reached while processing ${relativePath}.`);
            break;
          }

          extractedFiles.push({
            path: relativePath,
            name: filename,
            size: content.length,
            content,
            isCode: CODE_EXTENSIONS.has(ext) || isLikelyCode(filename, content),
            truncated: isFileTruncated,
          });

          totalExtractedChars += content.length;
          fileCount++;
        }
      } catch (err) {
        console.warn(`Could not read file ${relativePath} from zip:`, err);
      }
    }

    // Build structured codebase context string for LLM models
    const formattedContext = buildCodebaseContext(file.name, fileTree, extractedFiles, warnings, 'zip');

    return {
      filename: file.name,
      archiveType: 'zip',
      totalFiles: entries.length,
      extractedCodeFilesCount: extractedFiles.length,
      fileTree,
      files: extractedFiles,
      formattedContext,
      warnings,
      wasTruncated,
    };
  } catch (err: any) {
    console.warn('[ZipReader] Client extraction failed or fallback needed:', err);
    // Fallback to server extraction endpoint
    return extractViaServerEndpoint(file);
  }
}

/**
 * Extracts and parses code files from an uploaded .rar archive file
 */
export async function extractCodeFromRar(file: File): Promise<ZipArchiveResult> {
  return extractViaServerEndpoint(file);
}

/**
 * Server-side extraction fallback supporting both .rar and .zip archives
 */
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

/**
 * Unified archive extractor supporting .zip, .rar, .tar, .tgz archives
 */
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
  // Check first 1000 chars for null bytes
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
    lowerName === 'cmakelists.txt'
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
  warnings: string[] = [],
  archiveType: 'zip' | 'rar' | 'archive' = 'archive'
): string {
  const label = archiveType.toUpperCase();
  let context = `================================================================================\n`;
  context += `ATTACHED ${label} CODEBASE ARCHIVE: ${archiveName}\n`;
  context += `Extracted ${files.length} code & text files (${fileTree.length} total entries in archive)\n`;
  context += `[CODEBASE EXTRACTION NOTICE: All files from the uploaded archive have been decompressed, parsed, and provided in full below as plain text. You have complete direct access to inspect and cite every file, function, and line of code. You do not need to unzip anything. Do NOT claim you cannot read zip files or access the code.]\n`;
  if (warnings.length > 0) {
    context += `ATTACHMENT GUARDRAIL WARNINGS:\n`;
    warnings.forEach((w) => {
      context += `- ${w}\n`;
    });
  }
  context += `================================================================================\n\n`;

  context += `[CODEBASE FILE TREE]\n`;
  fileTree.forEach((path) => {
    context += `- ${path}\n`;
  });
  context += `\n`;

  context += `[CODEBASE FILE CONTENTS]\n`;
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

