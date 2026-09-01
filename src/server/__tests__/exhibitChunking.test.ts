import { describe, it, expect } from 'vitest';
import { chunkContext } from '../exhibitChunking';

describe('chunkContext', () => {
  it('returns a single chunk for text under the cap', () => {
    const out = chunkContext('a,b\n1,2\n3,4');
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('a,b\n1,2\n3,4');
    expect(out[0].total).toBe(1);
  });

  it('splits 443KB of CSV rows into ~5 chunks with no data lost', () => {
    // 443KB-ish: ~4,430 rows of ~100 chars
    const row = '2026-08-01,acme LLC,premium,149.99,active,US,monthly,auto-renew,card-4417,team-seat-12\n';
    const text = 'id,date,account,plan,price,status,country,billing,method,seat\n' + row.repeat(5080);
    expect(text.length).toBeGreaterThan(430_000);
    expect(text.length).toBeLessThan(460_000);

    const chunks = chunkContext(text, { strategy: 'csv-rows' });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.length).toBeLessThanOrEqual(6);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(101_000);
      expect(c.content.length).toBeGreaterThanOrEqual(39_000);
    }
    // nothing lost: reassembly is exact
    expect(chunks.map((c) => c.content).join('')).toBe(text);
    // every chunk boundary after the first falls on a row break
    for (const c of chunks.slice(1)) {
      expect(c.content.startsWith('id,') || c.content[c.content.length - 1] === '\n').toBe(true);
    }
    // indices are 1..n
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.total === chunks.length)).toBe(true);
  });

  it('splits paragraph text at paragraph boundaries', () => {
    const para = 'The quarterly revenue rose 12% because of expansion into two new regions and higher retention.\n\n';
    const text = para.repeat(1500); // ~141KB
    const chunks = chunkContext(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.map((c) => c.content).join('')).toBe(text);
  });
});
