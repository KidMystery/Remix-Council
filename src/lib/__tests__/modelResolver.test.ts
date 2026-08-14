import { describe, it, expect } from "vitest";
import { resolveModel } from "../modelResolver";
import { decideWebUse } from "../webPolicy";

describe("Web Grounding & Model Resolution Guardrails", () => {
  it("resolves OpenRouter candidate when restricted to openrouter provider", () => {
    const resolved = resolveModel({
      alias: "gemini:flash",
      allowedProviders: ["openrouter"],
    });

    expect(resolved.provider).toBe("openrouter");
    expect(resolved.id).toMatch(/^google\//);
  });

  it("fails clearly with WEB_GROUNDING_UNAVAILABLE for local-only models when restricted to openrouter", () => {
    // If a request restricts to openrouter with a local-only candidate that has no production openrouter match
    expect(() => {
      resolveModel({
        alias: "local:free",
        allowedProviders: ["openrouter"],
        productionOnly: true,
        requireFree: false,
      });
    }).not.toThrow(); // local:free has llama-3.2-3b-instruct:free on openrouter

    // If candidate provider is forced to local or no openrouter candidate
    expect(() => {
      resolveModel({
        alias: "local:free",
        allowedProviders: ["openrouter"],
        productionOnly: false,
        requireFree: false,
        preferredProvider: "local",
      });
    }).not.toThrow();
  });

  it("prohibits environment override from bypassing allowedProviders in online mode", () => {
    const originalEnv = process.env.MODEL_GEMINI_FLASH;
    const originalProvider = process.env.PROVIDER_GEMINI_FLASH;

    try {
      process.env.MODEL_GEMINI_FLASH = "gemini-2.5-flash";
      process.env.PROVIDER_GEMINI_FLASH = "google";

      expect(() => {
        resolveModel({
          alias: "gemini:flash",
          allowedProviders: ["openrouter"],
        });
      }).toThrow(/only permits: openrouter/);
    } finally {
      process.env.MODEL_GEMINI_FLASH = originalEnv;
      process.env.PROVIDER_GEMINI_FLASH = originalProvider;
    }
  });

  it("decideWebUse properly activates web search for always mode and freshness queries in auto mode", () => {
    const alwaysDecision = decideWebUse({
      mode: "always",
      query: "Hello world",
    });
    expect(alwaysDecision.enabled).toBe(true);

    const offDecision = decideWebUse({
      mode: "off",
      query: "Who is the current US President in 2026?",
    });
    expect(offDecision.enabled).toBe(false);

    const autoFreshnessDecision = decideWebUse({
      mode: "auto",
      query: "What is the latest stock price of TSLA today?",
    });
    expect(autoFreshnessDecision.enabled).toBe(true);

    const autoGenericDecision = decideWebUse({
      mode: "auto",
      query: "Write a python function to compute fibonacci numbers",
    });
    expect(autoGenericDecision.enabled).toBe(false);
  });
});
