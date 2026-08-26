import { describe, expect, it } from 'vitest';
import {
  extractFencedBlocks,
  formatSandboxReport,
  verifyMissionCode,
  verifySnippet,
} from '../codeSandbox';
import { buildCodebaseContext, parseCodebaseContext, zipResultFromAttached } from '../zipUtils';

describe('code sandbox verifier', () => {
  it('parses fenced blocks', () => {
    const blocks = extractFencedBlocks('see\n```js\nconst x = 1\n```\nand\n```json\n{"a":1}\n```');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].language).toBe('js');
    expect(blocks[1].code).toContain('"a"');
  });

  it('parses JSON and JS without executing JS', () => {
    const marker = '__sandbox_ran__';
    (globalThis as any)[marker] = false;
    const js = verifySnippet('javascript', `${marker} = true; throw new Error('should not run');`);
    expect(js.status).toBe('ok');
    expect((globalThis as any)[marker]).toBe(false);
    delete (globalThis as any)[marker];

    expect(verifySnippet('json', '{"ok":true}').status).toBe('ok');
    expect(verifySnippet('json', '{nope').status).toBe('error');
    expect(verifySnippet('javascript', 'function (').status).toBe('error');
    expect(verifySnippet('python', 'print(1)').status).toBe('skipped');
  });

  it('collects fences from panelists and json files', () => {
    const checks = verifyMissionCode({
      texts: ['```js\nconst a = 1\n```'],
      files: [{ name: 'pack.json', content: '{"name":"x"}' }],
    });
    expect(checks.some((c) => c.language === 'javascript' && c.status === 'ok')).toBe(true);
    expect(checks.some((c) => c.language === 'json' && c.status === 'ok')).toBe(true);
    expect(formatSandboxReport(checks)).toContain('never executed');
  });
});

describe('zip inspect rebuild', () => {
  it('round-trips FILE sections from a formatted dump', () => {
    const dump = buildCodebaseContext(
      'app.zip',
      ['src/a.ts', 'package.json'],
      [
        { path: 'package.json', name: 'package.json', size: 2, content: '{}', isCode: true },
        { path: 'src/a.ts', name: 'a.ts', size: 11, content: 'export const x = 1', isCode: true },
      ],
      [],
      [],
      false,
      [],
      13,
      'zip'
    );
    const files = parseCodebaseContext(dump);
    expect(files.map((f) => f.path)).toEqual(['package.json', 'src/a.ts']);
    expect(files[1].content).toBe('export const x = 1');

    const result = zipResultFromAttached({ name: 'app.zip', type: 'zip', content: dump });
    expect(result?.files).toHaveLength(2);
    expect(result?.filename).toBe('app.zip');
  });

  it('still lights inspect when the dump has no FILE headers', () => {
    const result = zipResultFromAttached({ name: 'old.zip', type: 'zip', content: 'just a blob' });
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0].content).toBe('just a blob');
  });

  it('returns null for a CSV', () => {
    expect(zipResultFromAttached({ name: 'spend.csv', content: 'a,b' })).toBeNull();
  });
});
