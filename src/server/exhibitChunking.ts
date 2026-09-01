/**
 * Exhibit/context chunking — split oversized text at natural boundaries
 * (CSV rows / paragraphs) so nothing is silently sliced away.
 */

export interface ContextChunk {
  content: string;
  index: number;
  total: number;
}

/** Target size per chunk. Chunks may run slightly under/over to hit a boundary. */
const CHUNK_TARGET_CHARS = 100_000;
const CHUNK_MIN_CHARS = 40_000;

function boundaryScore(text: string, pos: number, csvLike: boolean): number {
  // Prefer the strongest natural boundary nearest to the target.
  if (pos <= 0 || pos >= text.length) return -1;
  if (csvLike && text[pos - 1] === '\n') return 5;
  if (text[pos - 1] === '\n' && text[pos] === '\n') return 4; // paragraph break
  if (text[pos - 1] === '\n') return 3;
  if (text[pos - 1] === ' ') return 2;
  if (/[.!?;,\)]/.test(text[pos - 1])) return 1;
  return 0;
}

/**
 * Splits text into chunks at natural boundaries (CSV rows when the text
 * looks like a table, else paragraphs/sentences), each roughly CHUNK_TARGET_CHARS.
 */
export function chunkContext(text: string, opts?: { strategy?: string }): ContextChunk[] {
  if (!text) return [];
  if (text.length <= CHUNK_TARGET_CHARS) {
    return [{ content: text, index: 0, total: 1 }];
  }
  const csvLike = (opts?.strategy || 'auto') === 'csv-rows' || /^[^\n]*,[^\n]*\n/.test(text);
  const chunks: ContextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_TARGET_CHARS);
    if (end < text.length) {
      // search backwards from the hard cut for the best boundary, but never
      // below the minimum so chunks stay balanced
      const minEnd = start + CHUNK_MIN_CHARS;
      let best = end;
      let bestScore = -1;
      for (let p = end; p > minEnd; p--) {
        const s = boundaryScore(text, p, csvLike);
        if (s > bestScore) {
          bestScore = s;
          best = p;
        }
        if (bestScore >= 4) break;
      }
      end = best;
    }
    chunks.push({ content: text.slice(start, end), index: chunks.length, total: 0 });
    start = end;
  }
  for (const c of chunks) c.total = chunks.length;
  return chunks;
}
