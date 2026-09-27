import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OptimizationMode,
  RouteTestResult,
} from "../../shared/types";
import type { RuntimeSettings } from "./settingsStore";
import { PublicError } from "./publicError";
import { negotiateMcpTools } from "./mcpCapabilities";
import { sendTimedHttpRequest } from "./routeDiagnostics";
import { createBoundedFetch, MAX_MCP_RESPONSE_BYTES } from "./responseLimits";
import {
  buildMcpOptimizationInput,
  MAX_MCP_PROMPT_CHARACTERS,
} from "./clarificationPolicy";

export const REQUIRED_MCP_TOOLS = [
  "optimize-user-prompt",
  "optimize-system-prompt",
  "iterate-prompt",
] as const;

function toolNameForMode(
  mode: OptimizationMode,
): (typeof REQUIRED_MCP_TOOLS)[number] {
  if (mode === "system") return "optimize-system-prompt";
  if (mode === "iterate") return "iterate-prompt";
  return "optimize-user-prompt";
}

function routeQuality(totalMs: number): RouteTestResult["quality"] {
  if (totalMs < 650) return "excellent";
  if (totalMs < 1_500) return "good";
  if (totalMs < 4_000) return "moderate";
  return "high";
}

function mcpHeaders(settings: RuntimeSettings): Record<string, string> | undefined {
  return settings.mcpAccessToken
    ? { Authorization: `Bearer ${settings.mcpAccessToken}` }
    : undefined;
}

async function closeClient(
  client: Client,
  transport: StreamableHTTPClientTransport,
): Promise<void> {
  if (transport.sessionId) {
    await transport.terminateSession().catch(() => undefined);
  }
  await client.close().catch(() => undefined);
}

async function connectClient(
  settings: RuntimeSettings,
  signal: AbortSignal,
  timeout: number,
): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> {
  const client = new Client(
    { name: "prompt-float", version: "0.3.0" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(settings.mcpUrl), {
    requestInit: {
      redirect: "error",
      headers: mcpHeaders(settings),
    },
    fetch: createBoundedFetch(
      (url, init) => fetch(url, { ...init, redirect: "error" }),
      MAX_MCP_RESPONSE_BYTES,
      "MCP 响应超过安全上限，已停止读取",
    ),
  });
  try {
    await client.connect(transport, { signal, timeout });
    return { client, transport };
  } catch (error) {
    await client.close().catch(() => undefined);
    if (signal.aborted) throw error;
    throw new PublicError(
      "无法连接 Prompt Optimizer MCP，请确认服务已启动、路由地址和访问令牌正确",
    );
  }
}

function hasTextContent(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const content = (response as { content?: unknown }).content;
  return (
    Array.isArray(content) &&
    content.some(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string" &&
        (item as { text: string }).text.trim().length > 0,
    )
  );
}

export async function testMcpRoute(
  settings: RuntimeSettings,
  externalSignal?: AbortSignal,
): Promise<RouteTestResult> {
  const controller = new AbortController();
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;
  const timeout = setTimeout(() => controller.abort(), 35_000);
  const startedAt = Date.now();
  let session:
    | Awaited<ReturnType<typeof connectClient>>
    | undefined;

  try {
    // MCP GET without a session intentionally returns 400 on a compliant server.
    // It is only used to obtain DNS/TCP/TLS/first-byte timing before the real SDK flow.
    const transportProbe = await sendTimedHttpRequest({
      url: settings.mcpUrl,
      method: "GET",
      headers: mcpHeaders(settings),
      signal,
      timeoutMs: 15_000,
      maxResponseBytes: 16_384,
    });

    const handshakeStartedAt = Date.now();
    session = await connectClient(settings, signal, 15_000);
    const mcpHandshakeMs = Date.now() - handshakeStartedAt;
    const discoveryStartedAt = Date.now();
    await negotiateMcpTools(
      session.client,
      REQUIRED_MCP_TOOLS,
      signal,
    );
    const toolDiscoveryMs = Date.now() - discoveryStartedAt;

    const modelProbeStartedAt = Date.now();
    const probe = await session.client.callTool(
      {
        name: "optimize-user-prompt",
        arguments: { prompt: "仅返回 READY，用于验证模型路由。" },
      },
      undefined,
      { signal, timeout: 20_000 },
    );
    const modelProbeMs = Date.now() - modelProbeStartedAt;
    if (("isError" in probe && probe.isError) || !hasTextContent(probe)) {
      throw new PublicError(
        "MCP 服务已连接，但服务端模型没有返回有效的探测响应",
      );
    }

    const totalMs = Date.now() - startedAt;
    return {
      ok: true,
      host: settings.mcpHost,
      quality: routeQuality(totalMs),
      timing: {
        ...transportProbe.timing,
        totalMs,
        mcpHandshakeMs,
        toolDiscoveryMs,
        modelProbeMs,
      },
      message: `MCP 路由 ${settings.routeName} 已完成握手、工具发现和最小模型探测`,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PublicError("MCP 路由测试超时（35 秒）");
    }
    if (error instanceof PublicError) throw error;
    throw new PublicError("MCP 握手、工具检查或模型探测失败");
  } finally {
    clearTimeout(timeout);
    if (session) await closeClient(session.client, session.transport);
  }
}

export interface McpOptimizeOptions {
  mode: OptimizationMode;
  prompt: string;
  requirements?: string;
  settings: RuntimeSettings;
  signal: AbortSignal;
  onChunk: (chunk: string) => void;
}

export async function optimizePromptWithMcp({
  mode,
  prompt,
  requirements,
  settings,
  signal,
  onChunk,
}: McpOptimizeOptions): Promise<string> {
  if (mode === "iterate" && !requirements?.trim()) {
    throw new PublicError("迭代优化需要填写具体改进要求");
  }
  const sourcePrompt = prompt.trim();
  let mcpPrompt = sourcePrompt;
  if (mode !== "iterate") {
    mcpPrompt = buildMcpOptimizationInput(mode, sourcePrompt);
    if (mcpPrompt.length > MAX_MCP_PROMPT_CHARACTERS) {
      const maxOriginal = MAX_MCP_PROMPT_CHARACTERS -
        buildMcpOptimizationInput(mode, "").length;
      throw new PublicError(
        `MCP 提示词过长；为澄清规则预留空间后，原文最多 ${maxOriginal.toLocaleString()} 字`,
      );
    }
  }

  let session:
    | Awaited<ReturnType<typeof connectClient>>
    | undefined;
  try {
    session = await connectClient(settings, signal, 20_000);
    await negotiateMcpTools(
      session.client,
      [toolNameForMode(mode)],
      signal,
    );
    const args: Record<string, string> = { prompt: mcpPrompt };
    if (mode === "iterate") args.requirements = requirements!.trim();

    const response = await session.client.callTool(
      { name: toolNameForMode(mode), arguments: args },
      undefined,
      { signal, timeout: 110_000 },
    );
    if (
      !("content" in response) ||
      !Array.isArray(response.content) ||
      response.isError
    ) {
      throw new PublicError(
        "Prompt Optimizer MCP 执行失败，请检查该路由服务端模型配置",
      );
    }

    const result = response.content
      .filter(
        (item): item is { type: "text"; text: string } =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string",
      )
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (!result) throw new PublicError("Prompt Optimizer MCP 返回了空结果");
    if (result.length > 100_000) {
      throw new PublicError("Prompt Optimizer MCP 返回内容过长，已拒绝载入");
    }
    onChunk(result);
    return result;
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof PublicError) throw error;
    throw new PublicError("Prompt Optimizer MCP 请求失败");
  } finally {
    if (session) await closeClient(session.client, session.transport);
  }
}
