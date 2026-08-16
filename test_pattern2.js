const ALLOWED_MODEL_PATTERN = /^([a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)(:[a-z0-9._-]+)?$/i;
console.log("google/gemini-pro:free: ", ALLOWED_MODEL_PATTERN.test("google/gemini-pro:free"));
console.log("x-ai/grok-beta: ", ALLOWED_MODEL_PATTERN.test("x-ai/grok-beta"));
console.log("cognitivecomputations/dolphin3.0-r1-mistral-24b:free: ", ALLOWED_MODEL_PATTERN.test("cognitivecomputations/dolphin3.0-r1-mistral-24b:free"));
