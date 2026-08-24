export type ModelAlias =
  | "gemini:flash"
  | "gemini:pro"
  | "claude:sonnet"
  | "openai:balanced"
  | "openai:cheap"
  | "deepseek:reasoning"
  | "deepseek:chat"
  | "local:free";

export type ModelProvider =
  | "openrouter"
  | "google"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "local";

export interface ModelCandidate {
  id: string;
  label: string;
  provider: ModelProvider;
  production: boolean;
  free?: boolean;
}

/** Standard latest Gemini model constants */
export const LATEST_GEMINI_FLASH = "google/gemini-2.5-flash";
export const LATEST_GEMINI_PRO = "google/gemini-2.5-pro";
export const LATEST_DIRECT_GEMINI_FLASH = "gemini-2.5-flash";
export const LATEST_DIRECT_GEMINI_PRO = "gemini-2.5-pro";

export const MODEL_CATALOG: Record<ModelAlias, ModelCandidate[]> = {
  "gemini:flash": [
    {
      id: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "google/gemini-3.7-flash",
      label: "Gemini 3.7 Flash (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash (Google Direct)",
      provider: "google",
      production: true,
      free: false,
    },
  ],
  "gemini:pro": [
    {
      id: "google/gemini-2.5-pro",
      label: "Gemini 2.5 Pro (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro (Google Direct)",
      provider: "google",
      production: true,
      free: false,
    },
  ],
  "claude:sonnet": [
    {
      id: "anthropic/claude-sonnet-4.5",
      label: "Claude Sonnet 4.5 (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "claude-sonnet-4-5-20250929",
      label: "Claude Sonnet 4.5 (Anthropic Direct)",
      provider: "anthropic",
      production: true,
      free: false,
    },
  ],
  "openai:balanced": [
    {
      id: "openai/gpt-5.1",
      label: "GPT-5.1 (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "openai/gpt-4o",
      label: "GPT-4o (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "openai/o3-mini",
      label: "o3-mini (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "gpt-4o",
      label: "GPT-4o (OpenAI Direct)",
      provider: "openai",
      production: true,
      free: false,
    },
  ],
  "openai:cheap": [
    {
      id: "openai/gpt-4o-mini",
      label: "GPT-4o Mini (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "gpt-4o-mini",
      label: "GPT-4o Mini (OpenAI Direct)",
      provider: "openai",
      production: true,
      free: false,
    },
  ],
  "deepseek:reasoning": [
    {
      id: "deepseek/deepseek-r1",
      label: "DeepSeek R1 (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      // DeepSeek R1's free endpoint is delisted; current live free reasoning substitute.
      id: "openai/gpt-oss-120b:free",
      label: "GPT-OSS 120B (Free)",
      provider: "openrouter",
      production: true,
      free: true,
    },
    {
      id: "deepseek-reasoner",
      label: "DeepSeek R1 (DeepSeek Direct)",
      provider: "deepseek",
      production: true,
      free: false,
    },
  ],
  "deepseek:chat": [
    {
      id: "deepseek/deepseek-chat",
      label: "DeepSeek V3 Chat (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "deepseek-chat",
      label: "DeepSeek V3 Chat (DeepSeek Direct)",
      provider: "deepseek",
      production: true,
      free: false,
    },
  ],
  "local:free": [
    {
      id: "openai/gpt-oss-20b:free",
      label: "GPT-OSS 20B (Free)",
      provider: "openrouter",
      production: true,
      free: true,
    },
    {
      id: "nvidia/nemotron-3-nano-30b-a3b:free",
      label: "Nemotron 3 Nano 30B (Free)",
      provider: "openrouter",
      production: true,
      free: true,
    },
    {
      id: "ollama/llama3.2",
      label: "Llama 3.2 (Local)",
      provider: "local",
      production: false,
      free: true,
    },
  ],
};

export function getCandidates(alias: ModelAlias): ModelCandidate[] {
  return MODEL_CATALOG[alias] ? [...MODEL_CATALOG[alias]] : [];
}
