import type { AttachedFile } from '../types';

const MAX_UNCOMPRESSED_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_COMPRESSION_RATIO = 200;

export async function processZipArchive(
  file: File
): Promise<{ files: AttachedFile[]; totalSize: number }> {
  if (file.size > MAX_UNCOMPRESSED_SIZE_BYTES) {
    throw new Error(`Archive size exceeds 50MB maximum allowable ceiling (${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
  }

  // Use dynamic JSZip or client-side decompression
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  const extractedFiles: AttachedFile[] = [];
  let totalExtractedSize = 0;

  for (const [relativePath, zipEntry] of Object.entries(loadedZip.files)) {
    if (zipEntry.dir) continue;

    // Security check: Ignore hidden or system metadata files
    if (relativePath.includes('__MACOSX') || relativePath.startsWith('.')) continue;

    // Check individual entry uncompressed size
    const uncompressedSize = (zipEntry as any)._data?.uncompressedSize || 0;
    if (uncompressedSize > 10 * 1024 * 1024) {
      console.warn(`[ZipReader] Skipping oversized file: ${relativePath} (${uncompressedSize} bytes)`);
      continue;
    }

    // Zip bomb compression ratio check
    const compressedSize = (zipEntry as any)._data?.compressedSize || 1;
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
      throw new Error(`Zip bomb defense triggered: Compression ratio for "${relativePath}" exceeds safe limit (${(uncompressedSize / compressedSize).toFixed(0)}x).`);
    }

    try {
      const content = await zipEntry.async('string');
      totalExtractedSize += content.length;

      if (totalExtractedSize > MAX_UNCOMPRESSED_SIZE_BYTES) {
        throw new Error('Total uncompressed archive size exceeds 50MB ceiling.');
      }

      extractedFiles.push({
        name: relativePath,
        content,
        size: content.length,
      });
    } catch (err: any) {
      console.warn(`[ZipReader] Could not read ${relativePath} as text:`, err.message);
    }
  }

  return { files: extractedFiles, totalSize: totalExtractedSize };
}
