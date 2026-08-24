/**
 * Model candidate resolution and validation for OpenRouter routing and web grounding.
 */

export const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  // Generic / Latest Aliases
  "gemini": "google/gemini-2.5-flash",
  "gemini flash": "google/gemini-2.5-flash",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini pro": "google/gemini-2.5-pro",
  "gemini-pro": "google/gemini-2.5-pro",
  "claude sonnet": "anthropic/claude-3.7-sonnet",
  "claude-sonnet": "anthropic/claude-3.7-sonnet",

  // Google Gemini Specific
  "gemini 3.7 flash": "google/gemini-3.7-flash",
  "gemini-3.7-flash": "google/gemini-3.7-flash",
  "gemini 2.5 flash": "google/gemini-2.5-flash",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
  "gemini 2.0 flash": "google/gemini-2.0-flash-001",
  "gemini-2.0-flash": "google/gemini-2.0-flash-001",
  "gemini-2.0-flash-001": "google/gemini-2.0-flash-001",
  "gemini 2.5 pro": "google/gemini-2.5-pro",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini 2.0 flash exp": "google/gemini-2.0-flash-exp:free",
  "gemini-2.0-flash-exp": "google/gemini-2.0-flash-exp:free",
  "gemini 1.5 pro": "google/gemini-pro-1.5",
  "gemini-1.5-pro": "google/gemini-pro-1.5",
  "gemini 1.5 flash": "google/gemini-flash-1.5",
  "gemini-1.5-flash": "google/gemini-flash-1.5",
  "gemma 2 9b": "google/gemma-2-9b-it:free",
  "gemma-2-9b-it": "google/gemma-2-9b-it:free",
  "gemma 2 27b": "google/gemma-2-27b-it",
  "gemma-2-27b-it": "google/gemma-2-27b-it",

  // Anthropic Claude
  "claude 3.7 sonnet": "anthropic/claude-3.7-sonnet",
  "claude-3.7-sonnet": "anthropic/claude-3.7-sonnet",
  "claude 3.5 sonnet": "anthropic/claude-3.5-sonnet",
  "claude-3.5-sonnet": "anthropic/claude-3.5-sonnet",
  "claude 3.5 haiku": "anthropic/claude-3.5-haiku",
  "claude-3.5-haiku": "anthropic/claude-3.5-haiku",
  "claude 3 opus": "anthropic/claude-3-opus",
  "claude-3-opus": "anthropic/claude-3-opus",
  "claude 3 haiku": "anthropic/claude-3-haiku",
  "claude-3-haiku": "anthropic/claude-3-haiku",

  // OpenAI
  "gpt-4o": "openai/gpt-4o",
  "gpt 4o": "openai/gpt-4o",
  "gpt-4o mini": "openai/gpt-4o-mini",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt 4o mini": "openai/gpt-4o-mini",
  "o3-mini": "openai/o3-mini",
  "o3 mini": "openai/o3-mini",
  "o1": "openai/o1",
  "o1-mini": "openai/o1-mini",
  "o1 mini": "openai/o1-mini",
  "gpt-4-turbo": "openai/gpt-4-turbo",
  "gpt-3.5-turbo": "openai/gpt-3.5-turbo",

  // DeepSeek
  "deepseek r1": "deepseek/deepseek-r1",
  "deepseek-r1": "deepseek/deepseek-r1",
  "deepseek v3": "deepseek/deepseek-chat",
  "deepseek-v3": "deepseek/deepseek-chat",
  "deepseek chat": "deepseek/deepseek-chat",
  "deepseek-chat": "deepseek/deepseek-chat",
  "deepseek r1 free": "deepseek/deepseek-r1:free",

  // Meta Llama
  "llama 3.3 70b instruct": "meta-llama/llama-3.3-70b-instruct",
  "llama-3.3-70b-instruct": "meta-llama/llama-3.3-70b-instruct",
  "llama 3.3 70b": "meta-llama/llama-3.3-70b-instruct",
  "llama 3.1 70b instruct": "meta-llama/llama-3.1-70b-instruct",
  "llama-3.1-70b-instruct": "meta-llama/llama-3.1-70b-instruct",
  "llama 3.1 8b instruct": "meta-llama/llama-3.1-8b-instruct:free",
  "llama-3.1-8b-instruct": "meta-llama/llama-3.1-8b-instruct:free",
  "llama 3.2 3b instruct": "meta-llama/llama-3.2-3b-instruct:free",
  "llama-3.2-3b-instruct": "meta-llama/llama-3.2-3b-instruct:free",

  // Qwen
  "qwen 2.5 72b instruct": "qwen/qwen-2.5-72b-instruct",
  "qwen-2.5-72b-instruct": "qwen/qwen-2.5-72b-instruct",
  "qwen 2.5 72b": "qwen/qwen-2.5-72b-instruct",
  "qwen 2.5 coder 32b instruct": "qwen/qwen-2.5-coder-32b-instruct",
  "qwen-2.5-coder-32b-instruct": "qwen/qwen-2.5-coder-32b-instruct",
  "qwen 2.5 7b instruct": "qwen/qwen-2.5-7b-instruct:free",
  "qwen-2.5-7b-instruct": "qwen/qwen-2.5-7b-instruct:free",

  // Mistral
  "mistral large": "mistralai/mistral-large",
  "mistral-large": "mistralai/mistral-large",
  "mistral small": "mistralai/mistral-small",
  "mistral-small": "mistralai/mistral-small",
  "mistral nemo": "mistralai/mistral-nemo:free",
  "mistral-nemo": "mistralai/mistral-nemo:free",
  "mistral 7b instruct": "mistralai/mistral-7b-instruct:free",
  "mistral-7b-instruct": "mistralai/mistral-7b-instruct:free",

  // Nvidia
  "nemotron 3.5 content safety": "nvidia/nemotron-3.5-content-safety:free",
  "nemotron-3.5-content-safety": "nvidia/nemotron-3.5-content-safety:free",
  "nemotron 70b instruct": "nvidia/llama-3.1-nemotron-70b-instruct",
};

/**
 * Resolves a model alias or ID to a standard production OpenRouter candidate ID.
 * Returns null if the model is purely local/offline without a remote candidate.
 */
export function resolveOpenRouterCandidate(rawModel: string): string | null {
  if (!rawModel || typeof rawModel !== 'string') return null;

  let trimmed = rawModel.trim();
  const lower = trimmed.toLowerCase();

  // Strip extraneous labels
  const withoutParens = lower
    .replace(/\s*\(free\)/g, '')
    .replace(/\s*\(paid\)/g, '')
    .replace(/\s*\(nitro\)/g, '')
    .trim();

  // 1. Direct alias match
  if (OPENROUTER_MODEL_ALIASES[withoutParens]) {
    const candidate = OPENROUTER_MODEL_ALIASES[withoutParens];
    if (trimmed.toLowerCase().includes('(free)') && !candidate.endsWith(':free')) {
      return candidate;
    }
    return candidate;
  }

  // 2. OpenRouter format already provided (e.g. 'google/gemini-2.5-flash')
  if (trimmed.includes('/')) {
    if (trimmed.startsWith('google/') ||
        trimmed.startsWith('anthropic/') ||
        trimmed.startsWith('openai/') ||
        trimmed.startsWith('deepseek/') ||
        trimmed.startsWith('meta-llama/') ||
        trimmed.startsWith('qwen/') ||
        trimmed.startsWith('mistralai/') ||
        trimmed.startsWith('nvidia/')) {
      return trimmed;
    }
  }

  // 3. Fallback prefix inference
  if (lower.startsWith('gemini-') || lower.startsWith('gemini ')) {
    const slug = lower.replace(/\s+/g, '-');
    return `google/${slug}`;
  }
  if (lower.startsWith('claude-') || lower.startsWith('claude ')) {
    const slug = lower.replace(/\s+/g, '-');
    return `anthropic/${slug}`;
  }
  if (lower.startsWith('gpt-') || lower.startsWith('gpt ') || lower.startsWith('o1') || lower.startsWith('o3')) {
    const slug = lower.replace(/\s+/g, '-');
    return `openai/${slug}`;
  }
  if (lower.startsWith('deepseek-') || lower.startsWith('deepseek ')) {
    const slug = lower.replace(/\s+/g, '-');
    return `deepseek/${slug}`;
  }
  if (lower.startsWith('llama-') || lower.startsWith('llama ')) {
    const slug = lower.replace(/\s+/g, '-');
    return `meta-llama/${slug}`;
  }
  if (lower.startsWith('qwen-') || lower.startsWith('qwen ')) {
    const slug = lower.replace(/\s+/g, '-');
    return `qwen/${slug}`;
  }

  return null;
}

export function isLocalOnlyModel(modelId: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith('local/') ||
    lower.startsWith('ollama/') ||
    lower.startsWith('lmstudio/') ||
    lower.includes('localhost') ||
    lower.includes('127.0.0.1')
  );
}
