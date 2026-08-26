/**
 * Sandboxed Code Verifier — compile / parse only.
 * Never invokes snippets. No network, no filesystem, no shell.
 */

export type SandboxStatus = 'ok' | 'error' | 'skipped';

export interface SandboxCheck {
  language: string;
  preview: string;
  status: SandboxStatus;
  detail: string;
}

export const SANDBOX_MAX_SNIPPETS = 8;
export const SANDBOX_MAX_CHARS = 8_000;

export function extractFencedBlocks(text: string): Array<{ language: string; code: string }> {
  if (!text) return [];
  const out: Array<{ language: string; code: string }> = [];
  const re = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ language: (m[1] || 'text').toLowerCase(), code: m[2] });
  }
  return out;
}

export function languageFromFilename(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.js') || n.endsWith('.mjs') || n.endsWith('.cjs')) return 'javascript';
  if (n.endsWith('.jsx')) return 'javascript';
  if (n.endsWith('.ts') && !n.endsWith('.d.ts')) return 'typescript';
  if (n.endsWith('.tsx')) return 'typescript';
  return '';
}

function previewOf(code: string): string {
  return code.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Compile or parse. Never call the compiled function. */
export function verifySnippet(language: string, code: string): SandboxCheck {
  const lang = (language || 'text').toLowerCase();
  const preview = previewOf(code);
  const body = code.length > SANDBOX_MAX_CHARS ? code.slice(0, SANDBOX_MAX_CHARS) : code;

  if (lang === 'json') {
    try {
      JSON.parse(body);
      return { language: 'json', preview, status: 'ok', detail: 'JSON parsed' };
    } catch (err: any) {
      return { language: 'json', preview, status: 'error', detail: err?.message || 'invalid JSON' };
    }
  }

  if (lang === 'javascript' || lang === 'js' || lang === 'mjs' || lang === 'cjs') {
    try {
      // Compile only — do not invoke.
      // eslint-disable-next-line no-new-func
      new Function(body);
      return { language: 'javascript', preview, status: 'ok', detail: 'JS syntax compiled (not executed)' };
    } catch (err: any) {
      return { language: 'javascript', preview, status: 'error', detail: err?.message || 'syntax error' };
    }
  }

  if (lang === 'typescript' || lang === 'ts' || lang === 'tsx') {
    try {
      // eslint-disable-next-line no-new-func
      new Function(body);
      return { language: lang, preview, status: 'ok', detail: 'compiled as JS (types not checked)' };
    } catch {
      return {
        language: lang,
        preview,
        status: 'skipped',
        detail: 'TypeScript not executed — no TS parser in this sandbox',
      };
    }
  }

  return {
    language: lang || 'text',
    preview,
    status: 'skipped',
    detail: `no interpreter for ${lang || 'plain text'}`,
  };
}

export function verifyMissionCode(opts: {
  texts: string[];
  files?: Array<{ name: string; content: string }>;
}): SandboxCheck[] {
  const checks: SandboxCheck[] = [];
  const push = (c: SandboxCheck) => {
    if (checks.length < SANDBOX_MAX_SNIPPETS) checks.push(c);
  };

  for (const text of opts.texts) {
    for (const block of extractFencedBlocks(text)) {
      if (checks.length >= SANDBOX_MAX_SNIPPETS) return checks;
      if (!block.code.trim()) continue;
      push(verifySnippet(block.language, block.code));
    }
  }

  for (const file of opts.files || []) {
    if (checks.length >= SANDBOX_MAX_SNIPPETS) break;
    const lang = languageFromFilename(file.name);
    if (!lang || !file.content?.trim()) continue;
    push(verifySnippet(lang, file.content));
  }

  return checks;
}

export function formatSandboxReport(checks: SandboxCheck[]): string {
  if (checks.length === 0) return '';
  const lines = ['[Sandboxed Code Verifier — compile/parse only, never executed]'];
  for (const c of checks) {
    lines.push(`- ${c.status.toUpperCase()} (${c.language}): ${c.detail} — ${c.preview}`);
  }
  return lines.join('\n');
}
