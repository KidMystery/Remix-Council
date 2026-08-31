import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csvParse';

describe('parseCsv', () => {
  it('parses a basic CSV with headers', () => {
    const out = parseCsv('name,age\nAda,36\nGrace,45');
    expect(out.headers).toEqual(['name', 'age']);
    expect(out.rows).toEqual([
      ['Ada', '36'],
      ['Grace', '45'],
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const out = parseCsv('name,note\n"Turner, Ada","said ""hello"""\n"Line\nBreak",2');
    expect(out.headers).toEqual(['name', 'note']);
    expect(out.rows).toEqual([
      ['Turner, Ada', 'said "hello"'],
      ['Line\nBreak', '2'],
    ]);
  });

  it('keeps ragged rows as-is', () => {
    const out = parseCsv('a,b,c\n1,2\n9,8,7,extra');
    expect(out.headers).toEqual(['a', 'b', 'c']);
    expect(out.rows).toEqual([
      ['1', '2'],
      ['9', '8', '7', 'extra'],
    ]);
  });

  it('returns empty for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv('  \n \r\n')).toEqual({ headers: [], rows: [] });
  });

  it('strips a UTF-8 BOM before parsing', () => {
    const out = parseCsv('\uFEFFcol,second\nx,y');
    expect(out.headers).toEqual(['col', 'second']);
    expect(out.rows).toEqual([['x', 'y']]);
  });

  it('generates synthetic headers when the first row is clearly data', () => {
    const out = parseCsv('1,2.5\n3,4');
    expect(out.headers).toEqual(['column_1', 'column_2']);
    expect(out.rows).toEqual([
      ['1', '2.5'],
      ['3', '4'],
    ]);
  });
});
