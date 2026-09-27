import { getProviderDefinition, type ModelProviderId } from "../../shared/providers";
import type { ModelRoute, RouteInput } from "../../shared/types";

export interface EndpointPreview {
  hostname: string;
  displayHost: string;
  isLoopback: boolean;
}

export function previewEndpoint(value: string): EndpointPreview | null {
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.toLowerCase();
    return {
      hostname,
      displayHost: parsed.host,
      isLoopback: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
        hostname,
      ),
    };
  } catch {
    return null;
  }
}

export function routeToDraft(route: ModelRoute): RouteInput {
  return {
    id: route.id,
    name: route.name,
    engine: route.engine,
    provider: route.provider,
    baseUrl: route.baseUrl,
    model: route.model,
    confirmedApiHost: route.confirmedApiHost,
    mcpUrl: route.mcpUrl,
    confirmedMcpHost: route.confirmedMcpHost,
  };
}

export function newRouteDraft(): RouteInput {
  const provider = getProviderDefinition("openai");
  return {
    name: "新模型路由",
    engine: "direct",
    provider: provider.id,
    baseUrl: provider.defaultBaseUrl,
    model: provider.fallbackModels[0] || "",
    mcpUrl: "http://127.0.0.1:3000/mcp",
  };
}

export function modelsFor(provider: ModelProviderId, currentModel: string): string[] {
  const fallback = [...getProviderDefinition(provider).fallbackModels];
  return mergeModels(currentModel, fallback);
}

export function mergeModels(currentModel: string, models: string[]): string[] {
  return [
    ...new Set(
      [currentModel, ...models]
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ];
}

export function sameRouteDraft(route: ModelRoute, draft: RouteInput): boolean {
  const saved = routeToDraft(route);
  return (
    saved.id === draft.id &&
    saved.name === draft.name &&
    saved.engine === draft.engine &&
    saved.provider === draft.provider &&
    saved.baseUrl === draft.baseUrl &&
    saved.model === draft.model &&
    saved.confirmedApiHost === draft.confirmedApiHost &&
    saved.mcpUrl === draft.mcpUrl &&
    saved.confirmedMcpHost === draft.confirmedMcpHost
  );
}


export function sameStoredCredential(route: ModelRoute | undefined, draft: RouteInput): boolean {
  if (!route?.hasCredential || route.engine !== draft.engine) return false;
  if (route.provider !== draft.provider) return false;
  return route.engine === "direct"
    ? route.baseUrl.replace(/\/+$/, "") === draft.baseUrl.replace(/\/+$/, "")
    : route.mcpUrl.replace(/\/+$/, "") === draft.mcpUrl.replace(/\/+$/, "");
}
