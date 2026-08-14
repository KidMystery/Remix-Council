import {
  getCandidates,
  type ModelAlias,
  type ModelCandidate,
  type ModelProvider,
} from "../config/modelCatalog";

export type ResolveModelOptions = {
  alias: ModelAlias;
  preferredProvider?: ModelProvider;
  allowedProviders?: ModelProvider[];
  productionOnly?: boolean;
  requireFree?: boolean;
};

export type ResolvedModel = {
  alias: ModelAlias;
  provider: ModelProvider;
  id: string;
  label: string;
};

function getEnvModelId(alias: ModelAlias): string | undefined {
  switch (alias) {
    case "gemini:flash":
      return process.env.MODEL_GEMINI_FLASH;
    case "gemini:pro":
      return process.env.MODEL_GEMINI_PRO;
    case "claude:sonnet":
      return process.env.MODEL_CLAUDE_SONNET;
    case "openai:balanced":
      return process.env.MODEL_OPENAI_BALANCED;
    case "openai:cheap":
      return process.env.MODEL_OPENAI_CHEAP;
    case "deepseek:reasoning":
      return process.env.MODEL_DEEPSEEK_REASONING;
    case "deepseek:chat":
      return process.env.MODEL_DEEPSEEK_CHAT;
    case "local:free":
      return process.env.MODEL_LOCAL_FREE;
    default:
      return undefined;
  }
}

function getEnvProvider(alias: ModelAlias): ModelProvider | undefined {
  switch (alias) {
    case "gemini:flash":
      return process.env.PROVIDER_GEMINI_FLASH as ModelProvider | undefined;
    case "gemini:pro":
      return process.env.PROVIDER_GEMINI_PRO as ModelProvider | undefined;
    case "claude:sonnet":
      return process.env.PROVIDER_CLAUDE_SONNET as ModelProvider | undefined;
    case "openai:balanced":
      return process.env.PROVIDER_OPENAI_BALANCED as ModelProvider | undefined;
    case "openai:cheap":
      return process.env.PROVIDER_OPENAI_CHEAP as ModelProvider | undefined;
    case "deepseek:reasoning":
      return process.env.PROVIDER_DEEPSEEK_REASONING as ModelProvider | undefined;
    case "deepseek:chat":
      return process.env.PROVIDER_DEEPSEEK_CHAT as ModelProvider | undefined;
    case "local:free":
      return process.env.PROVIDER_LOCAL_FREE as ModelProvider | undefined;
    default:
      return undefined;
  }
}

export function resolveModel(options: ResolveModelOptions): ResolvedModel {
  const {
    alias,
    preferredProvider,
    allowedProviders,
    productionOnly = true,
    requireFree = false,
  } = options;

  const envModelId = getEnvModelId(alias);

  if (envModelId) {
    const envProvider =
      getEnvProvider(alias) ?? inferProviderFromId(envModelId);

    if (
      allowedProviders?.length &&
      !allowedProviders.includes(envProvider)
    ) {
      throw new Error(
        `Model override for "${alias}" uses provider "${envProvider}", ` +
          `but this request only permits: ${allowedProviders.join(", ")}. ` +
          `Fix MODEL_* / PROVIDER_* environment overrides.`,
      );
    }

    return {
      alias,
      provider: envProvider,
      id: envModelId,
      label: `${alias} environment override`,
    };
  }

  let candidates = getCandidates(alias);

  if (productionOnly) {
    candidates = candidates.filter((candidate) => candidate.production);
  }

  if (requireFree) {
    candidates = candidates.filter((candidate) => candidate.free === true);
  }

  if (allowedProviders?.length) {
    candidates = candidates.filter((candidate) =>
      allowedProviders.includes(candidate.provider),
    );
  }

  if (preferredProvider) {
    const preferred = candidates.find(
      (candidate) => candidate.provider === preferredProvider,
    );

    if (preferred) {
      return toResolved(alias, preferred);
    }
  }

  const first = candidates[0];

  if (!first) {
    throw new Error(
      `WEB_GROUNDING_UNAVAILABLE: no valid production model candidate for alias "${alias}". ` +
        `allowedProviders=${allowedProviders?.join(",") ?? "all"} ` +
        `preferredProvider=${preferredProvider ?? "none"} ` +
        `requireFree=${requireFree}`,
    );
  }

  return toResolved(alias, first);
}

function toResolved(
  alias: ModelAlias,
  candidate: ModelCandidate,
): ResolvedModel {
  return {
    alias,
    provider: candidate.provider,
    id: candidate.id,
    label: candidate.label,
  };
}

function inferProviderFromId(id: string): ModelProvider {
  if (id.startsWith("google/")) return "openrouter";
  if (id.startsWith("anthropic/")) return "openrouter";
  if (id.startsWith("openai/")) return "openrouter";
  if (id.startsWith("deepseek/")) return "openrouter";

  if (id.startsWith("gemini-") || id.startsWith("models/gemini-")) {
    return "google";
  }

  if (id.startsWith("gpt-")) return "openai";
  if (id.startsWith("claude-")) return "anthropic";
  if (id.startsWith("deepseek-")) return "deepseek";
  if (id.startsWith("ollama/")) return "local";

  throw new Error(
    `Cannot infer provider from model ID "${id}". ` +
      `Set the matching PROVIDER_* environment variable.`,
  );
}
