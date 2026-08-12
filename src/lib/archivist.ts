import { CouncilRound, PersonaResponse } from '../types';
import { streamOpenRouterCompletion } from './openrouter';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Standard heuristic: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

export interface ModelRates {
  prompt: number;     // USD per 1M prompt/input tokens
  completion: number; // USD per 1M completion/output tokens
}

export const MODEL_PRICING: Record<string, ModelRates> = {
  // Google
  'google/gemini-2.5-flash': { prompt: 0.10, completion: 0.40 },
  'google/gemini-2.0-flash': { prompt: 0.10, completion: 0.40 },
  'google/gemini-1.5-flash': { prompt: 0.075, completion: 0.30 },
  'google/gemini-pro-1.5': { prompt: 1.25, completion: 5.00 },
  'google/gemini-1.5-pro': { prompt: 1.25, completion: 5.00 },
  'google/gemini-2.0-pro-exp-02-05': { prompt: 1.25, completion: 5.00 },

  // Anthropic
  'anthropic/claude-3.5-haiku': { prompt: 0.80, completion: 4.00 },
  'anthropic/claude-3-5-haiku': { prompt: 0.80, completion: 4.00 },
  'anthropic/claude-3.5-sonnet': { prompt: 3.00, completion: 15.00 },
  'anthropic/claude-3-5-sonnet': { prompt: 3.00, completion: 15.00 },
  'anthropic/claude-3.7-sonnet': { prompt: 3.00, completion: 15.00 },

  // OpenAI
  'openai/gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
  'openai/gpt-4o': { prompt: 2.50, completion: 10.00 },
  'openai/o3-mini': { prompt: 1.10, completion: 4.40 },

  // DeepSeek
  'deepseek/deepseek-r1:free': { prompt: 0.00, completion: 0.00 },
  'deepseek/deepseek-r1': { prompt: 0.55, completion: 2.19 },
  'deepseek/deepseek-chat': { prompt: 0.14, completion: 0.28 },

  // Meta
  'meta-llama/llama-3.3-70b-instruct': { prompt: 0.12, completion: 0.30 },
};

export const DEFAULT_MODEL_RATES: ModelRates = { prompt: 0.30, completion: 1.20 };

export function registerModelPricing(modelId: string, promptRatePer1M: number, completionRatePer1M: number): void {
  if (!modelId) return;
  const normalized = modelId.toLowerCase().trim();
  MODEL_PRICING[normalized] = {
    prompt: Math.max(0, promptRatePer1M),
    completion: Math.max(0, completionRatePer1M),
  };
}

export function getModelRates(modelId?: string): ModelRates {
  if (!modelId) return DEFAULT_MODEL_RATES;
  const normalized = modelId.toLowerCase().trim();
  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized];

  if (normalized.includes('gemini') && normalized.includes('flash')) return MODEL_PRICING['google/gemini-2.5-flash'];
  if (normalized.includes('gemini') && normalized.includes('pro')) return MODEL_PRICING['google/gemini-pro-1.5'];
  if (normalized.includes('haiku')) return MODEL_PRICING['anthropic/claude-3.5-haiku'];
  if (normalized.includes('sonnet')) return MODEL_PRICING['anthropic/claude-3.5-sonnet'];
  if (normalized.includes('gpt-4o-mini')) return MODEL_PRICING['openai/gpt-4o-mini'];
  if (normalized.includes('gpt-4o')) return MODEL_PRICING['openai/gpt-4o'];
  if (normalized.includes(':free')) return { prompt: 0, completion: 0 };
  if (normalized.includes('deepseek')) return MODEL_PRICING['deepseek/deepseek-r1'];

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

/**
 * Archivist Summarizer: Hierarchical Memory Upgrade
 * Instead of discarding older rounds when token limit is approached,
 * the Archivist creates or builds a compressed Executive Summary of older rounds.
 */
export async function buildArchivistContext(options: {
  systemPrompt: string;
  userQuery: string;
  attachedImages?: { name: string; url: string; type: string }[];
  rounds: CouncilRound[];
  apiKey: string;
  maxTokensWindow?: number; // e.g. 3000 tokens
  signal?: AbortSignal;
}): Promise<{ role: 'system' | 'user' | 'assistant'; content: any }[]> {
  const { systemPrompt, userQuery, attachedImages, rounds, apiKey, maxTokensWindow = 3000, signal } = options;

  const messages: { role: 'system' | 'user' | 'assistant'; content: any }[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (rounds.length === 0) {
    if (attachedImages && attachedImages.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userQuery },
          ...attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } }))
        ]
      });
    } else {
      messages.push({ role: 'user', content: userQuery });
    }
    return messages;
  }

  // Calculate tokens for previous rounds
  const recentRoundsWindow = 2; // Keep most recent 2 rounds in full detail
  const recentRounds = rounds.slice(-recentRoundsWindow);
  const olderRounds = rounds.slice(0, Math.max(0, rounds.length - recentRoundsWindow));

  let contextBlocks: string[] = [];

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

        const summary = summaryRes.content;

        contextBlocks.push(`[Archivist Hierarchical Memory Summary (Rounds 1-${olderRounds.length})]:\n${summary}`);
      } catch (e) {
        // Fallback sync extraction if API call fails/aborts
        const fallbackSummary = olderRounds
          .map((r, i) => `R${i + 1} ("${r.userQuery.slice(0, 30)}..."): ${r.synthesis?.content?.slice(0, 100) || 'N/A'}`)
          .join('\n');
        contextBlocks.push(`[Archivist Compressed Memory (Rounds 1-${olderRounds.length})]:\n${fallbackSummary}`);
      }
    } else {
      // Render compressed round briefs
      const briefs = olderRounds
        .map((r, i) => `Round ${i + 1} Query: "${r.userQuery}" -> Consensus: ${r.synthesis?.content || 'Pending'}`)
        .join('\n');
      contextBlocks.push(`[Archivist Memory Archive (Rounds 1-${olderRounds.length})]:\n${briefs}`);
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
        ...attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } }))
      ]
    });
  } else {
    messages.push({
      role: 'user',
      content: contextBlocks.join('\n\n'),
    });
  }

  return messages;
}
