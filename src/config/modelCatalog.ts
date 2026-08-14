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
      id: "google/gemini-2.0-flash-001",
      label: "Gemini 2.0 Flash (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "google/gemini-2.0-flash-exp:free",
      label: "Gemini 2.0 Flash Exp (Free)",
      provider: "openrouter",
      production: true,
      free: true,
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
      id: "google/gemini-pro-1.5",
      label: "Gemini 1.5 Pro (OpenRouter)",
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
      id: "anthropic/claude-3.7-sonnet",
      label: "Claude 3.7 Sonnet (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "anthropic/claude-3.5-sonnet",
      label: "Claude 3.5 Sonnet (OpenRouter)",
      provider: "openrouter",
      production: true,
      free: false,
    },
    {
      id: "claude-3-7-sonnet-latest",
      label: "Claude 3.7 Sonnet (Anthropic Direct)",
      provider: "anthropic",
      production: true,
      free: false,
    },
  ],
  "openai:balanced": [
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
      id: "deepseek/deepseek-r1:free",
      label: "DeepSeek R1 (Free)",
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
      id: "meta-llama/llama-3.2-3b-instruct:free",
      label: "Llama 3.2 3B (Free)",
      provider: "openrouter",
      production: true,
      free: true,
    },
    {
      id: "google/gemini-2.0-flash-exp:free",
      label: "Gemini 2.0 Flash Exp (Free)",
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
