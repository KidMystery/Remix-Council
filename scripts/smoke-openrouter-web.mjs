import "dotenv/config";

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_WEB_SMOKE_MODEL || "google/gemini-2.0-flash-001";

if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY.");
  process.exit(1);
}

if (!model) {
  console.error(
    "Missing OPENROUTER_WEB_SMOKE_MODEL. Set it to a verified live OpenRouter model ID.",
  );
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

const response = await fetch(
  "https://openrouter.ai/api/v1/chat/completions",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(process.env.OPENROUTER_APP_URL
        ? { "HTTP-Referer": process.env.OPENROUTER_APP_URL }
        : {}),
      ...(process.env.OPENROUTER_APP_TITLE
        ? { "X-Title": process.env.OPENROUTER_APP_TITLE }
        : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: [
            `Current UTC date: ${today}.`,
            "Use web evidence.",
            "Return a concise answer with at least one actual source URL.",
            "Do not fabricate citations.",
          ].join("\n"),
        },
        {
          role: "user",
          content:
            "What is the latest official OpenRouter documentation page for web search? Include its URL.",
        },
      ],
      tools: [
        {
          type: "openrouter:web_search",
          parameters: {
            max_results: 3,
          },
        },
      ],
    }),
  },
);

const json = await response.json().catch(() => null);

if (!response.ok) {
  console.error(
    `OpenRouter web smoke test failed: ${response.status}`,
    JSON.stringify(json, null, 2),
  );
  process.exit(1);
}

const content = json?.choices?.[0]?.message?.content ?? "";

if (!content) {
  console.error(
    "OpenRouter returned no assistant content.",
    JSON.stringify(json, null, 2),
  );
  process.exit(1);
}

console.log("OpenRouter web smoke test passed.\n");
console.log(content);
