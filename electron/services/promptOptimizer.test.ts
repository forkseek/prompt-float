import { describe, expect, it, vi } from "vitest";
import type { RuntimeSettings } from "./settingsRepository";
import {
  buildModelProbeRequest,
  buildChatCompletionsUrl,
  buildOptimizationMessages,
  buildProviderOptimizationRequest,
  optimizePrompt,
  readChatCompletionStream,
} from "./promptOptimizer";

const runtimeSettings: RuntimeSettings = {
  routeId: crypto.randomUUID(),
  routeName: "测试路由",
  engine: "direct",
  provider: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiHost: "api.example.com",
  model: "test-model",
  apiKey: "secret",
  mcpUrl: "http://127.0.0.1:3000/mcp",
  mcpHost: "127.0.0.1:3000",
  mcpAccessToken: "",
  maxRequestsPerHour: 30,
  dailyTokenBudget: 200_000,
  maxOutputTokens: 2_048,
};

function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("prompt optimizer request building", () => {
  it("keeps the original prompt and selects user instructions", () => {
    const messages = buildOptimizationMessages("user", "帮我写文章 {{topic}}");
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("用户提示词优化器");
    expect(messages[0].content).toContain("具体问句");
    expect(messages[0].content).toContain("等到答复后再执行");
    expect(messages[1].content).toContain("帮我写文章 {{topic}}");
  });

  it("selects system prompt instructions", () => {
    expect(buildOptimizationMessages("system", "你是助手")[0].content).toContain(
      "系统提示词优化器",
    );
    expect(buildOptimizationMessages("system", "你是助手")[0].content).toContain(
      "收到实际用户任务时先做上述判断",
    );
  });

  it("normalizes chat completion URLs", () => {
    expect(buildChatCompletionsUrl("https://example.com/v1/")).toBe(
      "https://example.com/v1/chat/completions",
    );
    expect(
      buildChatCompletionsUrl("https://example.com/v1/chat/completions"),
    ).toBe("https://example.com/v1/chat/completions");
  });

  it("builds Anthropic Messages and Gemini GenerateContent requests natively", () => {
    const anthropic = buildProviderOptimizationRequest(
      {
        ...runtimeSettings,
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
      },
      "user",
      "原文",
      { maxOutputTokens: 512, stream: true },
    );
    expect(anthropic.url).toBe("https://api.anthropic.com/v1/messages");
    expect(anthropic.headers["x-api-key"]).toBe("secret");
    expect(JSON.parse(anthropic.body)).toMatchObject({
      max_tokens: 512,
      stream: true,
    });

    const gemini = buildProviderOptimizationRequest(
      {
        ...runtimeSettings,
        provider: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "models/gemini-test",
      },
      "system",
      "原文",
      { maxOutputTokens: 512, stream: true },
    );
    expect(gemini.url).toContain("/models/gemini-test:streamGenerateContent?alt=sse");
    expect(gemini.headers["x-goog-api-key"]).toBe("secret");
    expect(JSON.parse(gemini.body)).toMatchObject({
      generationConfig: { maxOutputTokens: 512 },
    });

    expect(
      JSON.parse(
        buildModelProbeRequest({ ...runtimeSettings, provider: "deepseek" }).body,
      ),
    ).toMatchObject({ max_tokens: 1, stream: true });
  });
});

describe("streaming responses", () => {
  it("parses chunks split at arbitrary byte boundaries and flushes final data", async () => {
    const chunks: string[] = [];
    const result = await readChatCompletionStream(
      byteStream([
        "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\r\n\r",
        "\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}",
      ]),
      (chunk) => chunks.push(chunk),
    );
    expect(result).toBe("你好");
    expect(chunks).toEqual(["你", "好"]);
  });

  it("supports multi-line SSE data and ignores keep-alives", async () => {
    const result = await readChatCompletionStream(
      byteStream([
        ": keepalive\n\n",
        "data: {\"choices\":[\n",
        "data: {\"delta\":{\"content\":\"多行\"}}\n",
        "data: ]}\n\n",
        "data: [DONE]\n\n",
      ]),
      () => undefined,
    );
    expect(result).toBe("多行");
  });

  it("stops a provider that ignores the configured output limit", async () => {
    await expect(
      readChatCompletionStream(
        byteStream([
          'data: {"choices":[{"delta":{"content":"123456"}}]}\n\n',
        ]),
        () => undefined,
        5,
      ),
    ).rejects.toThrow("模型返回内容超过本次安全上限");
  });

  it("sends max_tokens and supports non-streaming JSON fallbacks", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { max_tokens: number };
      expect(body.max_tokens).toBe(2_048);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "完整结果" } }] }),
        { headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const chunks: string[] = [];
    const result = await optimizePrompt({
      mode: "user",
      prompt: "原文",
      settings: runtimeSettings,
      signal: new AbortController().signal,
      onChunk: (chunk) => chunks.push(chunk),
      fetchImpl,
    });
    expect(result).toBe("完整结果");
    expect(chunks).toEqual(["完整结果"]);
  });

  it("rejects an oversized non-streaming JSON response before parsing", async () => {
    await expect(optimizePrompt({
      mode: "user",
      prompt: "原文",
      settings: runtimeSettings,
      signal: new AbortController().signal,
      onChunk: () => undefined,
      fetchImpl: (async () => new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "2097153",
        },
      })) as typeof fetch,
    })).rejects.toThrow("模型 JSON 响应过大");
  });

  it("reports usage from a completed JSON response", async () => {
    const reported: number[] = [];
    const result = await optimizePrompt({
      mode: "user",
      prompt: "原文",
      settings: runtimeSettings,
      signal: new AbortController().signal,
      onChunk: () => undefined,
      onUsage: (tokens) => reported.push(tokens),
      fetchImpl: (async () => new Response(JSON.stringify({
        choices: [{ message: { content: "完整结果" } }],
        usage: { prompt_tokens: 12, completion_tokens: 9 },
      }), { headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    expect(result).toBe("完整结果");
    expect(reported).toEqual([21]);
  });

  it("requests official OpenAI streaming usage and reads its terminal SSE event", async () => {
    const reported: number[] = [];
    const settings = {
      ...runtimeSettings,
      provider: "openai" as const,
      baseUrl: "https://api.openai.com/v1",
      apiHost: "api.openai.com",
    };
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        stream_options: { include_usage: true },
      });
      return new Response(byteStream([
        'data: {"choices":[{"delta":{"content":"优化结果"}}]}\n\n',
        'data: {"choices":[],"usage":{"total_tokens":37}}\n\n',
        "data: [DONE]\n\n",
      ]), { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const result = await optimizePrompt({
      mode: "user",
      prompt: "原文",
      settings,
      signal: new AbortController().signal,
      onChunk: () => undefined,
      onUsage: (tokens) => reported.push(tokens),
      fetchImpl,
    });
    expect(result).toBe("优化结果");
    expect(reported).toEqual([37]);
  });

  it("does not send unsupported streaming usage options to custom endpoints", () => {
    const request = buildProviderOptimizationRequest(runtimeSettings, "user", "原文", {
      maxOutputTokens: 128,
      stream: true,
    });
    expect(JSON.parse(request.body)).not.toHaveProperty("stream_options");
  });

  it("parses Anthropic and Gemini native streaming responses", async () => {
    const anthropicChunks: string[] = [];
    const anthropic = await optimizePrompt({
      mode: "user",
      prompt: "原文",
      settings: { ...runtimeSettings, provider: "anthropic" },
      signal: new AbortController().signal,
      onChunk: (chunk) => anthropicChunks.push(chunk),
      fetchImpl: (async () =>
        new Response(
          "event: content_block_delta\n" +
            'data: {"delta":{"text":"Claude"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        )) as typeof fetch,
    });
    expect(anthropic).toBe("Claude");
    expect(anthropicChunks).toEqual(["Claude"]);

    const gemini = await optimizePrompt({
      mode: "user",
      prompt: "原文",
      settings: {
        ...runtimeSettings,
        provider: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
      signal: new AbortController().signal,
      onChunk: () => undefined,
      fetchImpl: (async () =>
        new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"Gemini"}]}}]}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        )) as typeof fetch,
    });
    expect(gemini).toBe("Gemini");
  });

  it("does not expose provider response bodies in errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("internal-secret-details", { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(
      optimizePrompt({
        mode: "user",
        prompt: "原文",
        settings: runtimeSettings,
        signal: new AbortController().signal,
        onChunk: () => undefined,
        fetchImpl,
      }),
    ).rejects.toThrow("模型请求被拒绝（HTTP 400）");
  });

  it("propagates cancellation without converting it to a network error", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_url: unknown, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const request = optimizePrompt({
      mode: "user",
      prompt: "原文",
      settings: runtimeSettings,
      signal: controller.signal,
      onChunk: () => undefined,
      fetchImpl,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
