import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "./settingsRepository";
import { discoverProviderModels } from "./modelDiscovery";

const originalFetch = globalThis.fetch;

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    routeId: crypto.randomUUID(),
    routeName: "测试路由",
    engine: "direct",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    model: "test-model",
    apiKey: "secret",
    apiHost: "api.example.com",
    mcpUrl: "http://127.0.0.1:3000/mcp",
    mcpHost: "127.0.0.1:3000",
    mcpAccessToken: "",
    maxRequestsPerHour: 30,
    dailyTokenBudget: 200_000,
    maxOutputTokens: 2_048,
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("model discovery", () => {
  it("uses the OpenAI-compatible models endpoint and removes duplicate models", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: "b-model" }, { id: "a-model" }, { id: "a-model" }] }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await discoverProviderModels(settings());
    expect(result).toMatchObject({ source: "live", models: ["a-model", "b-model"] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/v1/models");
  });

  it("uses native Gemini listing and keeps generateContent models only", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-live", supportedGenerationMethods: ["generateContent"] },
            { name: "models/embed", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await discoverProviderModels(
      settings({
        provider: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      }),
    );
    expect(result.models).toEqual(["gemini-live"]);
  });

  it("returns fallback metadata for MCP routes without leaking a provider key", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await discoverProviderModels(
      settings({
        engine: "prompt-optimizer-mcp",
        provider: "deepseek",
        apiKey: "",
      }),
    );
    expect(result.source).toBe("fallback");
    expect(result.models).toContain("deepseek-v4-flash");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized model list before JSON parsing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", {
      headers: { "content-length": "2097153" },
    })) as typeof fetch;
    await expect(discoverProviderModels(settings())).rejects.toThrow(
      "模型列表响应过大",
    );
  });
});
