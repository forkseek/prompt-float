import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { RuntimeSettings } from "./settingsRepository";
import {
  optimizePromptWithMcp,
  testMcpRoute,
} from "./promptOptimizerMcp";

const toolNames = [
  "optimize-user-prompt",
  "optimize-system-prompt",
  "iterate-prompt",
];

let httpServer: HttpServer;
let endpoint = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (request, response) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport && !sessionId && isInitializeRequest(request.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => transports.set(id, transport!),
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      const server = new Server(
        { name: "prompt-optimizer-mock", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: toolNames.map((name) => ({
          name,
          inputSchema: { type: "object" as const, properties: {} },
        })),
      }));
      server.setRequestHandler(CallToolRequestSchema, async (toolRequest) => {
        const args = toolRequest.params.arguments as Record<string, string>;
        const suffix = args.requirements ? ` | ${args.requirements}` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `${toolRequest.params.name}: ${args.prompt}${suffix}`,
            },
          ],
        };
      });
      await server.connect(transport);
    }
    if (!transport) {
      response.status(400).json({ error: "invalid session" });
      return;
    }
    await transport.handleRequest(request, response, request.body);
  });

  app.get("/mcp", async (request, response) => {
    const id = request.headers["mcp-session-id"] as string | undefined;
    const transport = id ? transports.get(id) : undefined;
    if (!transport) {
      response.status(400).end();
      return;
    }
    await transport.handleRequest(request, response);
  });

  app.delete("/mcp", async (request, response) => {
    const id = request.headers["mcp-session-id"] as string | undefined;
    const transport = id ? transports.get(id) : undefined;
    if (!transport) {
      response.status(400).end();
      return;
    }
    await transport.handleRequest(request, response);
  });

  httpServer = await new Promise<HttpServer>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  endpoint = `http://127.0.0.1:${address.port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    httpServer.close((error) => (error ? reject(error) : resolve())),
  );
});

function settings(): RuntimeSettings {
  const host = new URL(endpoint).host;
  return {
    routeId: randomUUID(),
    routeName: "MCP 测试路由",
    engine: "prompt-optimizer-mcp",
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    apiHost: "api.example.com",
    model: "unused",
    apiKey: "",
    mcpUrl: endpoint,
    mcpHost: host,
    mcpAccessToken: "",
    maxRequestsPerHour: 30,
    dailyTokenBudget: 200_000,
    maxOutputTokens: 2_048,
  };
}

describe("Prompt Optimizer MCP adapter", () => {
  it("performs a real SDK handshake and verifies all official tool names", async () => {
    const result = await testMcpRoute(settings());
    expect(result.ok).toBe(true);
    expect(result.message).toContain("模型探测");
    expect(result.timing.mcpHandshakeMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.modelProbeMs).toBeGreaterThanOrEqual(0);
  });

  it("passes a caller cancellation signal into the MCP route probe", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(testMcpRoute(settings(), controller.signal)).rejects.toThrow();
  });

  it("calls optimize and iterate tools through Streamable HTTP", async () => {
    const userChunks: string[] = [];
    const userResult = await optimizePromptWithMcp({
      mode: "user",
      prompt: "原提示词",
      settings: settings(),
      signal: new AbortController().signal,
      onChunk: (chunk) => userChunks.push(chunk),
    });
    expect(userResult).toContain("optimize-user-prompt:");
    expect(userResult).toContain("<original_prompt>\n原提示词\n</original_prompt>");
    expect(userResult).toContain("具体问句");
    expect(userChunks).toEqual([userResult]);

    const systemResult = await optimizePromptWithMcp({
      mode: "system",
      prompt: "你是助手",
      settings: settings(),
      signal: new AbortController().signal,
      onChunk: () => undefined,
    });
    expect(systemResult).toContain("optimize-system-prompt:");
    expect(systemResult).toContain("收到实际用户任务时先做上述判断");

    const iterateResult = await optimizePromptWithMcp({
      mode: "iterate",
      prompt: "已有提示词",
      requirements: "更精炼",
      settings: settings(),
      signal: new AbortController().signal,
      onChunk: () => undefined,
    });
    expect(iterateResult).toBe("iterate-prompt: 已有提示词 | 更精炼");
  });

  it("rejects an MCP prompt that cannot fit the clarification instructions", async () => {
    await expect(optimizePromptWithMcp({
      mode: "user",
      prompt: "x".repeat(50_000),
      settings: settings(),
      signal: new AbortController().signal,
      onChunk: () => undefined,
    })).rejects.toThrow("MCP 提示词过长");
  });
});
