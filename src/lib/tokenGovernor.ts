/**
 * Token Governor — adaptive output-budget regulator.
 *
 * The governor learns, per governorKey (thread, persona, or stage), how many
 * output tokens a request actually needs:
 *  - If a response comes back truncated (`finish_reason: 'length'`), it
 *    automatically continues ("pick up exactly where you left off") with a
 *    larger budget, up to `maxExpansions` times.
 *  - It never shrinks the budget after a short answer. Oracle answers stay
 *    raw; a cheap previous turn must not starve the next one.
 *
 * Learned (expanded) budgets persist in localStorage and are clamped to [floor, cap].
 */
import { streamOpenRouterCompletion } from './openrouter';
import type { GroundingData } from '../types';

const GOV_STORAGE_KEY = 'council_token_governor_v1';
const FLOOR = 256;
const DEFAULT_BASE = 1200;
const DEFAULT_CAP = 8000;

export interface TokenGovernorOptions {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>;
  temperature?: number;
  budget?: 'free' | 'cheap' | 'quality';
  query?: string;
  signal?: AbortSignal;
  webSearch?: boolean;
  onToken?: (chunk: string) => void;
  onGrounding?: (grounding: GroundingData) => void;
  /** Starting budget; if omitted, the learned budget (or a default) is used. */
  baseMaxTokens?: number;
  /** Max continuation attempts after a truncated response. Default 2. */
  maxExpansions?: number;
  /** Budget multiplier on each continuation. Default 1.5. */
  expansionFactor?: number;
  /** Absolute ceiling for the output budget. Default 8000. */
  maxTokensCap?: number;
  /** Persistence key for the learned budget (e.g. thread id or persona id). */
  governorKey?: string;
  /** Called when the learned budget is adjusted. */
  onBudgetAdjust?: (newBudget: number, direction: 'up' | 'down') => void;
}

export interface TokenGovernorResult {
  content: string;
  actualModel: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  grounding?: GroundingData;
  finishReason?: string;
  expansions: number;
  finalBudget: number;
  learnedBudget: number;
}

function loadBudgets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(GOV_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveBudgets(budgets: Record<string, number>): void {
  try {
    localStorage.setItem(GOV_STORAGE_KEY, JSON.stringify(budgets));
  } catch {
    // ignore quota errors — the governor still works in-memory this session
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function isTruncated(reason?: string): boolean {
  return reason === 'length' || reason === 'max_tokens';
}

export async function streamWithTokenGovernor(
  options: TokenGovernorOptions
): Promise<TokenGovernorResult> {
  const {
    model,
    messages,
    temperature,
    budget,
    query,
    signal,
    webSearch,
    onToken,
    onGrounding,
    maxExpansions = 2,
    expansionFactor = 1.5,
    maxTokensCap = DEFAULT_CAP,
    governorKey = 'default',
    onBudgetAdjust,
  } = options;

  const budgets = loadBudgets();
  const cap = Math.max(FLOOR, maxTokensCap);
  let current = clamp(options.baseMaxTokens ?? budgets[governorKey] ?? DEFAULT_BASE, FLOOR, cap);

  let content = '';
  let usage: TokenGovernorResult['usage'];
  let grounding: GroundingData | undefined;
  let finishReason: string | undefined;
  let actualModel = model;
  let expansions = 0;

  let chat = messages.map((m) => ({ ...m }));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await streamOpenRouterCompletion({
      model,
      messages: chat,
      temperature,
      budget,
      query,
      signal,
      webSearch,
      maxTokens: current,
      onToken,
      onGrounding,
    });

    content += res.content || '';
    actualModel = res.actualModel || actualModel;
    finishReason = res.finishReason;
    if (res.grounding) grounding = res.grounding;
    if (res.usage) {
      usage = usage
        ? {
            promptTokens: (usage.promptTokens || 0) + (res.usage.promptTokens || 0),
            completionTokens: (usage.completionTokens || 0) + (res.usage.completionTokens || 0),
            totalTokens: (usage.totalTokens || 0) + (res.usage.totalTokens || 0),
          }
        : { ...res.usage };
    }

    if (isTruncated(res.finishReason)) {
      if (expansions >= maxExpansions) {
        // Still truncated at the ceiling — teach the governor to give more next time.
        const next = clamp(Math.floor(current * expansionFactor), FLOOR, cap);
        budgets[governorKey] = next;
        saveBudgets(budgets);
        onBudgetAdjust?.(next, 'up');
        break;
      }
      expansions++;
      chat = [
        ...chat,
        { role: 'assistant' as const, content: res.content || '' },
        {
          role: 'user' as const,
          content:
            'Continue exactly where you left off. Do not repeat anything from your previous response — pick up from the exact last word.',
        },
      ];
      current = clamp(Math.floor(current * expansionFactor), FLOOR, cap);
      continue;
    }

    break;
  }

  return {
    content,
    actualModel,
    usage,
    grounding,
    finishReason,
    expansions,
    finalBudget: current,
    learnedBudget: budgets[governorKey] ?? current,
  };
}
