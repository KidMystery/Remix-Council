import JSZip from 'jszip';

export interface ExtractedZipFile {
  path: string;
  name: string;
  size: number;
  content: string;
  isCode: boolean;
}

export interface ZipArchiveResult {
  filename: string;
  totalFiles: number;
  extractedCodeFilesCount: number;
  fileTree: string[];
  files: ExtractedZipFile[];
  formattedContext: string;
}

// Extensions considered source code or readable text
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'html', 'css', 'scss', 'less', 'sass',
  'py', 'java', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'kts',
  'md', 'markdown', 'txt', 'csv', 'yaml', 'yml', 'xml',
  'sql', 'sh', 'bash', 'zsh', 'env', 'example',
  'graphql', 'gql', 'proto', 'dockerfile', 'makefile', 'cmake', 'toml', 'ini'
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
 * Extracts and parses code files from an uploaded .zip archive file
 */
export async function extractCodeFromZip(file: File): Promise<ZipArchiveResult> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  const extractedFiles: ExtractedZipFile[] = [];
  const fileTree: string[] = [];

  const entries = Object.keys(loadedZip.files);

  for (const relativePath of entries) {
    const entry = loadedZip.files[relativePath];

    // Skip directories and system metadata
    if (entry.dir) continue;
    if (relativePath.includes('__MACOSX/') || relativePath.includes('.DS_Store') || relativePath.includes('.git/')) {
      continue;
    }
    if (relativePath.includes('node_modules/') || relativePath.includes('dist/') || relativePath.includes('.next/')) {
      continue;
    }

    fileTree.push(relativePath);

    const filename = relativePath.split('/').pop() || relativePath;
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    // Skip known binary extensions
    if (BINARY_EXTENSIONS.has(ext)) {
      continue;
    }

    try {
      // Read text content
      const content = await entry.async('string');

      // Check if text is valid (does not contain too many unprintable null bytes)
      if (isTextContent(content)) {
        extractedFiles.push({
          path: relativePath,
          name: filename,
          size: content.length,
          content,
          isCode: CODE_EXTENSIONS.has(ext) || isLikelyCode(filename, content),
        });
      }
    } catch (err) {
      console.warn(`Could not read file ${relativePath} from zip:`, err);
    }
  }

  // Build structured codebase context string for LLM models
  const formattedContext = buildCodebaseContext(file.name, fileTree, extractedFiles);

  return {
    filename: file.name,
    totalFiles: entries.length,
    extractedCodeFilesCount: extractedFiles.length,
    fileTree,
    files: extractedFiles,
    formattedContext,
  };
}

function isTextContent(str: string): boolean {
  if (!str) return true;
  // Check first 1000 chars for null bytes or control characters
  const sample = str.slice(0, 1000);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nullCount++;
  }
  return nullCount === 0;
}

function isLikelyCode(filename: string, content: string): boolean {
  const lowerName = filename.toLowerCase();
  if (lowerName === 'dockerfile' || lowerName === 'makefile' || lowerName.startsWith('.env')) return true;
  return content.includes('import ') || content.includes('function ') || content.includes('const ') || content.includes('class ');
}

function buildCodebaseContext(zipName: string, fileTree: string[], files: ExtractedZipFile[]): string {
  let context = `================================================================================\n`;
  context += `ATTACHED ZIP CODEBASE ARCHIVE: ${zipName}\n`;
  context += `Extracted ${files.length} code & text files (${fileTree.length} total entries in archive)\n`;
  context += `================================================================================\n\n`;

  context += `[CODEBASE FILE TREE]\n`;
  fileTree.forEach((path) => {
    context += `- ${path}\n`;
  });
  context += `\n`;

  context += `[CODEBASE FILE CONTENTS]\n`;
  files.forEach((file) => {
    context += `\n--------------------------------------------------------------------------------\n`;
    context += `FILE: ${file.path} (${file.size} chars)\n`;
    context += `--------------------------------------------------------------------------------\n`;
    context += file.content + `\n`;
  });

  context += `\n================================================================================\n`;
  context += `END OF ZIP CODEBASE ARCHIVE: ${zipName}\n`;
  context += `================================================================================\n`;

  return context;
}
