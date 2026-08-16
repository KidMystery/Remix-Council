import { describe, it, expect } from "vitest";
import { resolveModel } from "../modelResolver";

describe("Model Resolution Guardrails", () => {
  it("resolves OpenRouter candidate when restricted to openrouter provider", () => {
    const resolved = resolveModel({
      alias: "gemini:flash",
      allowedProviders: ["openrouter"],
    });

    expect(resolved.provider).toBe("openrouter");
    expect(resolved.id).toMatch(/^google\//);
  });

  it("handles model candidates appropriately for openrouter", () => {
    expect(() => {
      resolveModel({
        alias: "local:free",
        allowedProviders: ["openrouter"],
        productionOnly: true,
        requireFree: false,
      });
    }).not.toThrow();

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
});
