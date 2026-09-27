import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { RuntimeSettings } from "./settingsRepository";
import { testDirectRoute } from "./connectionTester";

let server: Server;
let baseUrl = "";
let receivedPayload: Record<string, unknown> | undefined;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      receivedPayload = JSON.parse(body) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "text/event-stream" });
      setTimeout(() => {
        response.end('data: {"choices":[{"delta":{"content":"READY"}}]}\n\n');
      }, 12);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function settings(): RuntimeSettings {
  return {
    routeId: crypto.randomUUID(),
    routeName: "本地探测路由",
    engine: "direct",
    provider: "openai-compatible",
    baseUrl,
    model: "probe-model",
    apiKey: "probe-secret",
    apiHost: new URL(baseUrl).host,
    mcpUrl: "http://127.0.0.1:3000/mcp",
    mcpHost: "127.0.0.1:3000",
    mcpAccessToken: "",
    maxRequestsPerHour: 30,
    dailyTokenBudget: 200_000,
    maxOutputTokens: 2_048,
  };
}

describe("direct route test", () => {
  it("sends a minimal real model probe and reports concrete timing phases", async () => {
    const result = await testDirectRoute(settings());
    expect(result.ok).toBe(true);
    expect(result.timing.sendMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.firstByteMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.firstResponseMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(
      result.timing.firstResponseMs ?? 0,
    );
    expect(receivedPayload).toMatchObject({
      model: "probe-model",
      stream: true,
      max_tokens: 1,
    });
  });

  it("passes a caller cancellation signal to the network probe", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(testDirectRoute(settings(), controller.signal)).rejects.toThrow();
  });
});
