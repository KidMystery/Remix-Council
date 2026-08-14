import { CouncilRound, PersonaResponse } from '../types';
import { streamOpenRouterCompletion } from './openrouter';
import type { RawOpenRouterModel } from './presets';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Standard heuristic: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

export interface ModelRates {
  prompt: number;     // USD per 1M prompt/input tokens
  completion: number; // USD per 1M completion/output tokens
}

// Initialize as an empty dynamic dictionary. This is populated dynamically from OpenRouter's catalog.
export const MODEL_PRICING: Record<string, ModelRates> = {};

export const DEFAULT_MODEL_RATES: ModelRates = { prompt: 0.30, completion: 1.20 };

export function registerModelPricing(modelId: string, promptRatePer1M: number, completionRatePer1M: number): void {
  if (!modelId) return;
  const normalized = modelId.toLowerCase().trim();
  MODEL_PRICING[normalized] = {
    prompt: Math.max(0, promptRatePer1M),
    completion: Math.max(0, completionRatePer1M),
  };
}

export function updateModelPricingFromOpenRouter(rawModels: RawOpenRouterModel[]): void {
  if (!rawModels || !Array.isArray(rawModels)) return;
  rawModels.forEach((m) => {
    if (m.id && m.pricing) {
      const promptVal = parseFloat(String(m.pricing.prompt || 0));
      const completionVal = parseFloat(String(m.pricing.completion || 0));
      registerModelPricing(m.id, promptVal * 1_000_000, completionVal * 1_000_000);
    }
  });
}

export function getModelRates(modelId?: string): ModelRates {
  if (!modelId) return DEFAULT_MODEL_RATES;
  const normalized = modelId.toLowerCase().trim();

  // 1. Prefer dynamically loaded pricing
  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized];

  // 2. Specific overrides for free models
  if (normalized.includes(':free')) return { prompt: 0, completion: 0 };

  // 3. Fallback to suitable heuristics if not yet fetched
  if (normalized.includes('gemini') && normalized.includes('flash')) return { prompt: 0.10, completion: 0.40 };
  if (normalized.includes('gemini') && normalized.includes('pro')) return { prompt: 1.25, completion: 5.00 };
  if (normalized.includes('haiku')) return { prompt: 0.80, completion: 4.00 };
  if (normalized.includes('sonnet')) return { prompt: 3.00, completion: 15.00 };
  if (normalized.includes('gpt-4o-mini')) return { prompt: 0.15, completion: 0.60 };
  if (normalized.includes('gpt-4o')) return { prompt: 2.50, completion: 10.00 };
  if (normalized.includes('deepseek')) return { prompt: 0.14, completion: 0.28 };
  if (normalized.includes('llama')) return { prompt: 0.12, completion: 0.30 };

  return DEFAULT_MODEL_RATES;
}

export function calculateCallCost(promptTokens: number, completionTokens: number, modelId?: string): number {
  const rates = getModelRates(modelId);
  const promptCost = (promptTokens / 1_000_000) * rates.prompt;
  const completionCost = (completionTokens / 1_000_000) * rates.completion;
  return promptCost + completionCost;
}

export function formatCost(costUSD: number): string {
  if (costUSD <= 0) return '$0.0000';
  if (costUSD < 0.0001) return '< $0.0001';
  return `$${costUSD.toFixed(4)}`;
}

export interface RoundCostMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCost: number;
  completionCost: number;
  totalCost: number;
}

export function countRoundCost(round: CouncilRound): RoundCostMetrics {
  let promptTokens = 0;
  let completionTokens = 0;
  let promptCost = 0;
  let completionCost = 0;

  const userQueryTokens = estimateTokens(round.userQuery);

  const processResponse = (r?: PersonaResponse | { content: string; model?: string; promptTokens?: number; completionTokens?: number; cost?: number }) => {
    if (!r || !r.content) return;
    const model = r.model || 'google/gemini-2.5-flash';
    const rates = getModelRates(model);

    let pTokens = r.promptTokens ?? userQueryTokens;
    let cTokens = r.completionTokens ?? estimateTokens(r.content);

    promptTokens += pTokens;
    completionTokens += cTokens;

    const pCost = (pTokens / 1_000_000) * rates.prompt;
    const cCost = (cTokens / 1_000_000) * rates.completion;

    promptCost += pCost;
    completionCost += cCost;
  };

  if (round.deliberation?.stage1) {
    Object.values(round.deliberation.stage1).forEach(processResponse);
  }
  if (round.deliberation?.stage2) {
    Object.values(round.deliberation.stage2).forEach(processResponse);
  }
  if (round.synthesis?.content) {
    processResponse(round.synthesis);
  }

  const totalCost = promptCost + completionCost;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    promptCost,
    completionCost,
    totalCost,
  };
}

export function countTotalSessionCost(rounds: CouncilRound[]): RoundCostMetrics {
  return rounds.reduce(
    (acc, round) => {
      const rc = countRoundCost(round);
      return {
        promptTokens: acc.promptTokens + rc.promptTokens,
        completionTokens: acc.completionTokens + rc.completionTokens,
        totalTokens: acc.totalTokens + rc.totalTokens,
        promptCost: acc.promptCost + rc.promptCost,
        completionCost: acc.completionCost + rc.completionCost,
        totalCost: acc.totalCost + rc.totalCost,
      };
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, promptCost: 0, completionCost: 0, totalCost: 0 }
  );
}

export function estimateCost(tokens: number): string {
  return formatCost(tokens * 0.0000005);
}

export function countRoundTokens(round: CouncilRound): number {
  return countRoundCost(round).totalTokens;
}

export function countTotalSessionTokens(rounds: CouncilRound[]): number {
  return countTotalSessionCost(rounds).totalTokens;
}

export interface BuildArchivistContextOptions {
  systemPrompt: string;
  userQuery: string;
  attachedImages?: { name: string; url: string; type: string }[];
  rounds: CouncilRound[];
  apiKey: string;
  maxTokensWindow?: number; // e.g. 3000 tokens
  recentRoundsWindow?: number; // Configurable number of recent rounds in full detail (default: 2)
  signal?: AbortSignal;
  onSummaryGenerated?: (summary: string) => void;
}

export type ArchivistContextMessages = { role: 'system' | 'user' | 'assistant'; content: any }[] & {
  archivistSummary?: string;
};

/**
 * Archivist Summarizer: Hierarchical Memory Upgrade
 * Instead of discarding older rounds when token limit is approached,
 * the Archivist creates or builds a compressed Executive Summary of older rounds.
 */
export async function buildArchivistContext(
  options: BuildArchivistContextOptions
): Promise<ArchivistContextMessages> {
  const {
    systemPrompt,
    userQuery,
    attachedImages,
    rounds,
    apiKey,
    maxTokensWindow = 3000,
    recentRoundsWindow: customRecentRounds = 2,
    signal,
    onSummaryGenerated,
  } = options;

  const recentRoundsWindow = Math.max(1, Math.min(10, customRecentRounds));

  const messages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (rounds.length === 0) {
    if (attachedImages && attachedImages.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userQuery },
          ...attachedImages.map((img) => ({ type: 'image_url', image_url: { url: img.url } })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: userQuery });
    }
    const res: ArchivistContextMessages = messages as any;
    return res;
  }

  // Calculate tokens for previous rounds using configurable window
  const recentRounds = rounds.slice(-recentRoundsWindow);
  const olderRounds = rounds.slice(0, Math.max(0, rounds.length - recentRoundsWindow));

  let contextBlocks: string[] = [];
  let archivistSummary: string | undefined = undefined;

  // If there are older rounds, run Archivist compression on them
  if (olderRounds.length > 0) {
    const olderTokens = countTotalSessionTokens(olderRounds);

    if (olderTokens > maxTokensWindow / 2) {
      // Create a fast summary of older rounds using Archivist persona logic
      const olderRoundsText = olderRounds
        .map(
          (r, idx) =>
            `Round ${idx + 1} Question: "${r.userQuery}"\nVerdict: ${r.synthesis?.content || 'No verdict'}`
        )
        .join('\n---\n');

      try {
        const summaryRes = await streamOpenRouterCompletion({
          apiKey,
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content:
                'You are the Council Archivist. Condense the historical deliberations and verdicts into a structured, highly dense memory summary capturing key decisions, unanswered questions, and core themes.',
            },
            {
              role: 'user',
              content: `Historical Council Rounds:\n${olderRoundsText}\n\nProvide a concise 3-4 sentence Archivist Memory Summary.`,
            },
          ],
          temperature: 0.3,
          maxTokens: 300,
          signal,
        });

        archivistSummary = summaryRes.content?.trim();
        contextBlocks.push(`[Archivist Hierarchical Memory Summary (Rounds 1-${olderRounds.length})]:\n${archivistSummary}`);
      } catch (e) {
        // Fallback sync extraction if API call fails/aborts
        archivistSummary = olderRounds
          .map((r, i) => `Round ${i + 1} ("${r.userQuery.slice(0, 50)}"): ${r.synthesis?.content?.slice(0, 150) || 'N/A'}`)
          .join('\n');
        contextBlocks.push(`[Archivist Compressed Memory (Rounds 1-${olderRounds.length})]:\n${archivistSummary}`);
      }
    } else {
      // Render compressed round briefs
      archivistSummary = olderRounds
        .map((r, i) => `Round ${i + 1} ("${r.userQuery}"): ${r.synthesis?.content || 'Pending'}`)
        .join('\n\n');
      contextBlocks.push(`[Archivist Memory Archive (Rounds 1-${olderRounds.length})]:\n${archivistSummary}`);
    }

    if (onSummaryGenerated && archivistSummary) {
      onSummaryGenerated(archivistSummary);
    }
  }

  // Append recent rounds in full synthesis context
  if (recentRounds.length > 0) {
    const recentText = recentRounds
      .map((r, i) => `Recent Round ${rounds.length - recentRounds.length + i + 1} ("${r.userQuery}") Consensus:\n${r.synthesis?.content || 'N/A'}`)
      .join('\n\n');
    contextBlocks.push(`[Recent Deliberations]:\n${recentText}`);
  }

  contextBlocks.push(`[Current Question]:\n${userQuery}`);

  if (attachedImages && attachedImages.length > 0) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: contextBlocks.join('\n\n') },
        ...attachedImages.map((img) => ({ type: 'image_url', image_url: { url: img.url } })),
      ],
    });
  } else {
    messages.push({
      role: 'user',
      content: contextBlocks.join('\n\n'),
    });
  }

  const result: ArchivistContextMessages = messages as any;
  result.archivistSummary = archivistSummary;
  return result;
}
