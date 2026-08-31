/**
 * Webhook notifier (Phase 4 "return wire").
 *
 * When HERMES_WEBHOOK_URL is set, outbound lifecycle events are POSTed as JSON
 * to that URL: fire-and-forget, 5s timeout, failures logged to diagnostics
 * (via the injected `log`) and NEVER thrown — a dead webhook must never break
 * a route. When the URL is unset the notifier is fully disabled (notify() is a
 * no-op and `enabled` is false), so deployments without it see zero behavior
 * change.
 *
 * Event schemas (stable contract for the Hermes-side receiver):
 *   { event: 'mission_completed' | 'mission_paused' | 'mission_failed',
 *     missionId, goal, pendingQuestions?, status, ts, agent }
 *   { event: 'oracle_entry_appended', threadId, agent, ts }
 *   { event: 'obligation_flagged', text, due?, action?, ts } — reserved for
 *     future use; due/action are parsed only if the text carries simple
 *     "due:"/"action:" prefixes (kept dead simple on purpose).
 */

export type WebhookEvent =
  | {
      event: 'mission_completed' | 'mission_paused' | 'mission_failed';
      missionId: string;
      goal: string;
      pendingQuestions?: string[];
      status: string;
      ts: number;
      agent: string;
    }
  | { event: 'oracle_entry_appended'; threadId: string; agent: string; ts: number }
  | { event: 'obligation_flagged'; text: string; due?: string; action?: string; ts: number };

export interface WebhookNotifierOptions {
  /** Diagnostics sink for delivery failures (defaults to console.warn). */
  log?: (message: string, meta?: Record<string, unknown>) => void;
  /** Injectable for tests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function createWebhookNotifier(url: string | undefined | null, options: WebhookNotifierOptions = {}) {
  const enabled = typeof url === 'string' && url.trim().length > 0;
  const target = enabled ? (url as string).trim() : null;
  const log = options.log || ((message: string, meta?: Record<string, unknown>) => console.warn(message, meta));
  const doFetch = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    /** True when HERMES_WEBHOOK_URL is configured. */
    get enabled(): boolean {
      return enabled;
    },

    /** Fire-and-forget POST; resolves immediately, never throws. */
    notify(event: WebhookEvent): void {
      if (!enabled || !target) return;
      const payload = JSON.stringify(event);
      // Intentionally not awaited — a slow/dead receiver must not delay the
      // request that triggered the event.
      void (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await doFetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: controller.signal,
          });
          if (!resp.ok) {
            log('[webhook] Delivery failed.', { status: resp.status, event: event.event });
          }
        } catch (err: any) {
          log('[webhook] Delivery failed.', {
            event: event.event,
            error: err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err?.message || String(err),
          });
        } finally {
          clearTimeout(timer);
        }
      })();
    },
  };
}

export type WebhookNotifier = ReturnType<typeof createWebhookNotifier>;

/**
 * Dead-simple obligation detection for oracle entries: an entry "flags" an
 * obligation when it starts with "obligation:" (case-insensitive) or contains
 * "TODO:". Kept intentionally trivial — no NLP, no config — per the Phase 4
 * spec. Optional "due:" / "action:" substrings are lifted into the event when
 * present.
 */
export function detectObligation(text: string): boolean {
  const t = (text || '').trim();
  return /^obligation:/i.test(t) || /TODO:/.test(t);
}

/** Extracts optional due:/action: hints from an obligation text (best-effort). */
export function parseObligationHints(text: string): { due?: string; action?: string } {
  const due = /(?:^|\s)due:\s*([^\n]*?)(?=\s+action:|$)/i.exec(text)?.[1]?.trim();
  const action = /(?:^|\s)action:\s*([^\n]+)/i.exec(text)?.[1]?.trim();
  return {
    ...(due ? { due } : {}),
    ...(action ? { action } : {}),
  };
}
