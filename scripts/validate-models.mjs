import { MODEL_CATALOG } from "../src/config/modelCatalog";

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

// Perform validation
validateOnlineRoutability(MODEL_CATALOG);

if (hasFailure) {
  console.error("Model catalog validation failed.");
  process.exit(1);
} else {
  console.log("All model catalog online routes validated successfully.");
}
