import { BudgetPolicy, GroundingData, GroundingSource, WebMode } from '../types';

export interface OpenRouterWebSearchTool {
  type: 'openrouter:web_search';
  parameters: {
    max_results: number;
    max_uses: number;
    max_total_results: number;
    search_context_size: 'low' | 'medium' | 'high';
  };
}

export function getWebSearchToolDefinition(): OpenRouterWebSearchTool {
  return {
    type: 'openrouter:web_search',
    parameters: {
      max_results: 5,
      max_uses: 2,
      max_total_results: 10,
      search_context_size: 'medium',
    },
  };
}

const TEMPORAL_KEYWORDS = [
  'current', 'currently', 'latest', 'recent', 'today', 'now', 'this week', 'this month',
  'this year', '2025', '2026', 'news', 'breaking', 'weather', 'stock price', 'market price',
  'release date', 'version', 'update', 'status of', 'who won', 'who is the current',
];

export function requiresCurrentInformation(query: string): boolean {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase();
  return TEMPORAL_KEYWORDS.some((kw) => q.includes(kw));
}

export function shouldEnableWebSearch(
  query: string,
  webMode: WebMode = 'off',
  budget: BudgetPolicy = 'cheap'
): { enabled: boolean; reason?: string } {
  if (webMode === 'off') {
    return { enabled: false, reason: 'Web search is disabled (mode: off).' };
  }

  // Strict Free cannot guarantee free web search across provider models
  if (budget === 'free') {
    return {
      enabled: false,
      reason: 'Web grounding is disabled under Strict Free budget to prevent unexpected search tool fees. Switch to Cheap or Quality budget to enable live web search.',
    };
  }

  if (webMode === 'always') {
    return { enabled: true, reason: 'Web search enabled (mode: always).' };
  }

  // Auto mode
  if (requiresCurrentInformation(query)) {
    return { enabled: true, reason: 'Auto-detected temporal query requiring live web information.' };
  }

  return { enabled: false, reason: 'Query does not require current/temporal web grounding.' };
}

export function parseWebSearchAnnotations(payload: any): GroundingData {
  const sources: GroundingSource[] = [];
  const queries: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { sources, queries };
  }

  // Check OpenRouter annotations or message tool calls
  const annotations = payload.annotations || payload.choices?.[0]?.message?.annotations;
  if (Array.isArray(annotations)) {
    for (const ann of annotations) {
      if (ann.type === 'url_citation' || ann.type === 'web_citation') {
        sources.push({
          title: ann.title || ann.url,
          url: ann.url,
        });
      }
    }
  }

  // Check tool calls
  const toolCalls = payload.tool_calls || payload.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (tc.type === 'function' && tc.function?.name === 'openrouter:web_search') {
        try {
          const args = typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
          if (args?.query) queries.push(args.query);
        } catch {
          // ignore parse error
        }
      }
    }
  }

  // Remove duplicate URLs
  const uniqueSources: GroundingSource[] = [];
  const seenUrls = new Set<string>();
  for (const s of sources) {
    if (s.url && !seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      uniqueSources.push(s);
    }
  }

  return {
    sources: uniqueSources,
    queries,
    searchCost: payload.usage?.web_search_cost || payload.search_cost || 0,
  };
}
