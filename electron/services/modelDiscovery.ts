import { getProviderDefinition } from "../../shared/providers";
import type { ModelDiscoveryResult } from "../../shared/types";
import type { RuntimeSettings } from "./settingsStore";
import { buildModelsUrl } from "./endpointPolicy";
import { PublicError } from "./publicError";
import { MAX_MODEL_LIST_JSON_BYTES, readBoundedJson } from "./responseLimits";

function buildAnthropicModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/models")) return normalized;
  return normalized.endsWith("/v1")
    ? `${normalized}/models`
    : `${normalized}/v1/models`;
}

function buildGeminiModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  const versionedBase = /\/v1(?:beta|alpha)?$/i.test(normalized)
    ? normalized
    : `${normalized}/v1beta`;
  return `${versionedBase}/models`;
}

function uniqueModels(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.trim().length > 0,
  ).map((value) => value.trim()))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function providerHeaders(settings: RuntimeSettings): Record<string, string> {
  if (settings.provider === "anthropic") {
    return {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  if (settings.provider === "gemini") {
    return { "x-goog-api-key": settings.apiKey };
  }
  return { Authorization: `Bearer ${settings.apiKey}` };
}

function providerModelsUrl(settings: RuntimeSettings): string {
  if (settings.provider === "anthropic") {
    return buildAnthropicModelsUrl(settings.baseUrl);
  }
  if (settings.provider === "gemini") {
    return buildGeminiModelsUrl(settings.baseUrl);
  }
  return buildModelsUrl(settings.baseUrl);
}

function extractModels(provider: RuntimeSettings["provider"], payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (provider === "gemini") {
    const models = Array.isArray(record.models) ? record.models : [];
    return uniqueModels(
      models.flatMap((model) => {
        if (!model || typeof model !== "object") return [];
        const item = model as Record<string, unknown>;
        const supported = Array.isArray(item.supportedGenerationMethods)
          ? item.supportedGenerationMethods
          : [];
        if (
          supported.length > 0 &&
          !supported.some((method) => method === "generateContent")
        ) {
          return [];
        }
        return [
          typeof item.name === "string"
            ? item.name.replace(/^models\//, "")
            : "",
        ];
      }),
    );
  }
  const data = Array.isArray(record.data) ? record.data : [];
  return uniqueModels(
    data.map((item) =>
      item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
        ? (item as { id: string }).id
        : "",
    ),
  );
}

function throwForModelListStatus(status: number): never {
  if (status === 401 || status === 403) {
    throw new PublicError("无法获取模型列表：API Key 无效或没有权限");
  }
  if (status === 404) {
    throw new PublicError("该供应商接口不支持模型列表，请手动填写模型名称");
  }
  if (status === 429) {
    throw new PublicError("获取模型列表被限流，请稍后重试");
  }
  throw new PublicError(`获取模型列表失败（HTTP ${status}）`);
}

export async function discoverProviderModels(
  settings: RuntimeSettings,
): Promise<ModelDiscoveryResult> {
  const definition = getProviderDefinition(settings.provider);
  if (settings.engine === "prompt-optimizer-mcp") {
    return {
      models: [...definition.fallbackModels],
      source: "fallback",
      message:
        "MCP 服务端决定实际模型；这里显示供应商建议列表，请填入该 MCP 路由服务端已配置的模型名称。",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(providerModelsUrl(settings), {
      method: "GET",
      headers: providerHeaders(settings),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throwForModelListStatus(response.status);
    const models = extractModels(
      settings.provider,
      await readBoundedJson(response, MAX_MODEL_LIST_JSON_BYTES, "模型列表响应过大，已停止读取"),
    );
    if (models.length > 0) {
      return {
        models,
        source: "live",
        message: `已从 ${definition.label} 获取 ${models.length} 个可用模型`,
      };
    }
    return {
      models: [...definition.fallbackModels],
      source: "fallback",
      message: "供应商未返回可用模型，已显示建议模型；也可手动填写。",
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PublicError("获取模型列表超时（15 秒）");
    }
    if (error instanceof PublicError) throw error;
    throw new PublicError("无法获取模型列表，请检查 API 地址、Key 和网络");
  } finally {
    clearTimeout(timeout);
  }
}
