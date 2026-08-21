/**
 * Document Chunker — splits oversized attachments into reviewable, ~page-sized
 * sections so the autonomous lab can actually read a 400-page document as
 * twenty 20-page parts (instead of truncating or summarizing it away).
 */

export interface ChunkSource {
  name: string;
  content: string;
}

export interface DocumentChunk {
  sourceName: string;
  index: number; // 0-based within its source
  globalIndex: number; // 0-based across all sources
  total: number; // total chunks for its source
  content: string;
  chars: number;
  estimatedPages: number;
  estimatedTokens: number;
}

export interface DocumentChunkPlan {
  chunks: DocumentChunk[];
  wasChunked: boolean;
  messages: string[];
}

export interface ChunkOptions {
  /** Target pages per chunk. Default 20. */
  pagesPerChunk?: number;
  /** Chars-per-page heuristic (~500 words/page). Default 3000. */
  charsPerPage?: number;
  /** Absolute safety cap on total chunks produced. Default 60. */
  maxChunks?: number;
}

const DEFAULT_CHARS_PER_PAGE = 3000;
const TOKENS_PER_CHAR = 0.25; // ~4 chars per token (English)

export function estimatePages(chars: number, charsPerPage = DEFAULT_CHARS_PER_PAGE): number {
  if (chars <= 0) return 0;
  return Math.max(1, Math.round(chars / charsPerPage));
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars * TOKENS_PER_CHAR);
}

/** Finds a clean break point near the target char count (paragraph → sentence → line → word). */
function findBreakPoint(text: string, target: number): number {
  const window = text.slice(0, target);
  const floor = Math.floor(target * 0.4);

  const para = window.lastIndexOf('\n\n');
  if (para > floor) return para + 2;

  const sentence = window.lastIndexOf('. ');
  if (sentence > floor) return sentence + 2;

  const newline = window.lastIndexOf('\n');
  if (newline > floor) return newline + 1;

  const space = window.lastIndexOf(' ');
  if (space > floor) return space + 1;

  return target;
}

export function splitContent(content: string, targetChars: number): string[] {
  const parts: string[] = [];
  let remaining = content.trim();
  while (remaining.length > targetChars) {
    const cut = findBreakPoint(remaining, targetChars);
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function chunkDocuments(sources: ChunkSource[], options: ChunkOptions = {}): DocumentChunkPlan {
  const pagesPerChunk = Math.max(1, options.pagesPerChunk ?? 20);
  const charsPerPage = Math.max(500, options.charsPerPage ?? DEFAULT_CHARS_PER_PAGE);
  const maxChunks = Math.max(1, options.maxChunks ?? 60);
  const targetChars = pagesPerChunk * charsPerPage;

  const chunks: DocumentChunk[] = [];
  const messages: string[] = [];
  let globalIndex = 0;
  let wasChunked = false;

  for (const src of sources) {
    const content = src.content || '';
    if (!content.trim()) continue;

    if (content.length <= targetChars) {
      chunks.push({
        sourceName: src.name,
        index: 0,
        globalIndex: globalIndex++,
        total: 1,
        content,
        chars: content.length,
        estimatedPages: estimatePages(content.length, charsPerPage),
        estimatedTokens: estimateTokens(content.length),
      });
      continue;
    }

    wasChunked = true;
    const parts = splitContent(content, targetChars);
    messages.push(
      `${src.name}: ${estimatePages(content.length, charsPerPage)} pages → ${parts.length} chunks of ~${pagesPerChunk} pages each.`
    );
    parts.forEach((p, i) => {
      chunks.push({
        sourceName: src.name,
        index: i,
        globalIndex: globalIndex++,
        total: parts.length,
        content: p,
        chars: p.length,
        estimatedPages: estimatePages(p.length, charsPerPage),
        estimatedTokens: estimateTokens(p.length),
      });
    });
  }

  if (chunks.length > maxChunks) {
    messages.push(`⚠️ ${chunks.length} chunks exceeds the ${maxChunks} safety cap — reviewing the first ${maxChunks}.`);
    chunks.length = maxChunks;
  }

  return { chunks, wasChunked, messages };
}
