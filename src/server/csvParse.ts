/**
 * Server-side CSV parsing for Nexus missions (Phase 3).
 *
 * A robust-enough RFC-4180-style parser: quoted fields, embedded commas and
 * newlines inside quotes, escaped double-quotes, CRLF, BOM, ragged rows.
 * Header-row detection: the first record is treated as headers when every
 * cell is non-empty and at least one cell is non-numeric; otherwise synthetic
 * column_N headers are generated and the first record stays data.
 */

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

export function parseCsv(raw: string): CsvParseResult {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  if (!text.trim()) return { headers: [], rows: [] };

  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // swallow (handles CRLF)
    } else if (ch === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const [first, ...rest] = nonEmpty;
  const looksLikeHeader =
    first.every((c) => c.trim() !== '') && first.some((c) => Number.isNaN(Number(c.trim())));

  if (looksLikeHeader) {
    return { headers: first.map((c) => c.trim()), rows: rest };
  }
  return {
    headers: first.map((_, idx) => `column_${idx + 1}`),
    rows: nonEmpty,
  };
}
