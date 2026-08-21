import { describe, it, expect } from 'vitest';
import { chunkDocuments, splitContent, estimatePages, estimateTokens } from '../documentChunker';

describe('documentChunker', () => {
  it('splits a long document into ~page-sized parts on paragraph boundaries', () => {
    // ~400 "pages" of text (400 * 3000 chars).
    const page = 'x'.repeat(3000);
    const content = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}.\n${page}`).join('\n\n');

    const plan = chunkDocuments([{ name: 'big.txt', content }], { pagesPerChunk: 20 });

    expect(plan.wasChunked).toBe(true);
    // 400 pages / 20 pages-per-part, with a little slack for paragraph boundaries.
    expect(plan.chunks.length).toBeGreaterThanOrEqual(19);
    expect(plan.chunks.length).toBeLessThanOrEqual(23);
    // All but the final (remainder) chunk should be close to 20 pages.
    const allButLast = plan.chunks.slice(0, -1);
    for (const c of allButLast) {
      expect(c.estimatedPages).toBeGreaterThanOrEqual(18);
      expect(c.estimatedPages).toBeLessThanOrEqual(22);
      expect(c.estimatedTokens).toBeGreaterThan(0);
    }
    // The final chunk is a remainder and must be smaller.
    expect(plan.chunks[plan.chunks.length - 1].estimatedPages).toBeLessThanOrEqual(22);
    // Chunks should be ordered and cover the whole source.
    expect(plan.chunks[0].index).toBe(0);
    expect(plan.chunks[plan.chunks.length - 1].index).toBe(plan.chunks.length - 1);
    expect(plan.chunks[0].sourceName).toBe('big.txt');
  });

  it('does not chunk small documents', () => {
    const plan = chunkDocuments([{ name: 'small.txt', content: 'hello world' }], { pagesPerChunk: 20 });
    expect(plan.wasChunked).toBe(false);
    expect(plan.chunks.length).toBe(1);
  });

  it('respects the maxChunks safety cap', () => {
    const content = 'y'.repeat(3000 * 400);
    const plan = chunkDocuments([{ name: 'huge.txt', content }], { pagesPerChunk: 20, maxChunks: 10 });
    expect(plan.chunks.length).toBe(10);
  });

  it('estimates pages and tokens', () => {
    expect(estimatePages(3000)).toBe(1);
    expect(estimatePages(30000)).toBe(10);
    expect(estimateTokens(4000)).toBe(1000);
  });

  it('splitContent preserves all words', () => {
    const content = 'word '.repeat(10000).trim();
    const parts = splitContent(content, 2000);
    const joined = parts.join(' ');
    expect(joined.split(' ').length).toBe(10000);
    expect(joined.split(' ').every((w) => w === 'word')).toBe(true);
  });
});
