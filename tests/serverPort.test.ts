import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import express from "express";
import { resolvePort } from "../server";

describe("Railway PORT validation and binding", () => {
  let activeServer: http.Server | null = null;

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => {
        activeServer!.close(() => resolve());
      });
      activeServer = null;
    }
  });

  it("safely resolves valid Railway PORT environment variables", () => {
    expect(resolvePort("4567")).toBe(4567);
    expect(resolvePort(4567)).toBe(4567);
    expect(resolvePort("8080")).toBe(8080);
    expect(resolvePort("5000")).toBe(5000);
  });

  it("safely falls back to default 3000 for local development or invalid PORT values", () => {
    expect(resolvePort(undefined)).toBe(3000);
    expect(resolvePort("")).toBe(3000);
    expect(resolvePort("   ")).toBe(3000);
    expect(resolvePort("invalid_port")).toBe(3000);
    expect(resolvePort("-1")).toBe(3000);
    expect(resolvePort("0")).toBe(3000);
    expect(resolvePort("70000")).toBe(3000);
  });

  it("proves custom PORT results in server listening and responding on 0.0.0.0", async () => {
    const testPort = resolvePort("4589");
    expect(testPort).toBe(4589);

    const app = express();
    app.get("/api/health", (req, res) => {
      res.json({ status: "ok" });
    });

    await new Promise<void>((resolve, reject) => {
      activeServer = app.listen(testPort, "0.0.0.0", () => {
        const address = activeServer?.address();
        if (address && typeof address === "object") {
          expect(address.port).toBe(4589);
          expect(address.address).toBe("0.0.0.0");
        }
        resolve();
      });
      activeServer.on("error", reject);
    });

    // Make an HTTP request to 127.0.0.1:4589/api/health to confirm network responsiveness
    const response = await fetch(`http://127.0.0.1:4589/api/health`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });
});
