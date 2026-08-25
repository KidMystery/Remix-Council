import { MODEL_CATALOG } from "../src/config/modelCatalog";
import {
  ORACLE_MODEL_OPTIONS,
  DEFAULT_ROTATION_ROSTER,
  DEFAULT_MINI_DELIBERATION_MODELS,
  VISION_SAFE_FALLBACK_MODEL,
} from "../src/lib/oracleStore";
import { isValidOpenRouterModelId } from "../src/lib/oracleModelPool";

let hasFailure = false;

function validateOnlineRoutability(modelCatalog) {
  for (const [alias, candidates] of Object.entries(modelCatalog)) {
    const hasAnyRemoteCandidate = candidates.some(
      (candidate) => candidate.provider !== "local",
    );

    const hasProductionOpenRouterCandidate = candidates.some(
      (candidate) =>
        candidate.provider === "openrouter" &&
        candidate.production === true,
    );

    if (hasAnyRemoteCandidate && !hasProductionOpenRouterCandidate) {
      console.error(
        `Missing OpenRouter online route for alias "${alias}". ` +
          "Web mode cannot safely route this model.",
      );
      hasFailure = true;
    }
  }
}

/**
 * Oracle curated roster checks (offline): every curated id must be
 * OpenRouter-form, unique, and vision-flagged; default rosters must only
 * reference curated ids; the vision fallback must be vision-capable.
 * Live-catalog liveness is re-checked at runtime by the model layer.
 */
function validateOracleRoster() {
  const seen = new Set();
  for (const opt of ORACLE_MODEL_OPTIONS) {
    if (!isValidOpenRouterModelId(opt.id)) {
      console.error(`Oracle curated entry "${opt.id}" is not a valid OpenRouter model id.`);
      hasFailure = true;
    }
    if (seen.has(opt.id)) {
      console.error(`Duplicate Oracle curated entry "${opt.id}".`);
      hasFailure = true;
    }
    seen.add(opt.id);
    if (typeof opt.vision !== "boolean") {
      console.error(`Oracle curated entry "${opt.id}" has no vision flag.`);
      hasFailure = true;
    }
  }

  for (const [label, roster] of [
    ["DEFAULT_ROTATION_ROSTER", DEFAULT_ROTATION_ROSTER],
    ["DEFAULT_MINI_DELIBERATION_MODELS", DEFAULT_MINI_DELIBERATION_MODELS],
  ]) {
    for (const id of roster) {
      if (!seen.has(id)) {
        console.error(`${label} references "${id}" which is not in ORACLE_MODEL_OPTIONS.`);
        hasFailure = true;
      }
    }
  }

  const fallback = ORACLE_MODEL_OPTIONS.find((m) => m.id === VISION_SAFE_FALLBACK_MODEL);
  if (!fallback) {
    console.error(`VISION_SAFE_FALLBACK_MODEL "${VISION_SAFE_FALLBACK_MODEL}" is not in ORACLE_MODEL_OPTIONS.`);
    hasFailure = true;
  } else if (!fallback.vision) {
    console.error(
      `VISION_SAFE_FALLBACK_MODEL "${VISION_SAFE_FALLBACK_MODEL}" is flagged text-only — the vision fallback must be vision-capable.`,
    );
    hasFailure = true;
  }
}

// Perform validation
validateOnlineRoutability(MODEL_CATALOG);
validateOracleRoster();

if (hasFailure) {
  console.error("Model catalog validation failed.");
  process.exit(1);
} else {
  console.log("All model catalog online routes validated successfully.");
  console.log(`Oracle curated roster validated: ${ORACLE_MODEL_OPTIONS.length} entries (${new Set(ORACLE_MODEL_OPTIONS.map((m) => m.id.split('/')[0])).size} labs).`);
}
