import { randomUUID } from "node:crypto";
import { z } from "zod";
import { JsonDocumentError } from "../infrastructure/jsonFile";
import {
  getProviderDefinition,
  inferProviderFromBaseUrl,
  PROVIDER_IDS,
  type ModelProviderId,
} from "../../shared/providers";
import type { OptimizationEngine, ThemePreference } from "../../shared/types";
import { inspectEndpoint, type EndpointInfo } from "./endpointPolicy";

type CredentialKind = "direct-api-key" | "mcp-access-token";

interface CredentialScope {
  kind: CredentialKind;
  provider: ModelProviderId;
  endpoint: string;
}

export interface StoredRoute {
  id: string;
  name: string;
  engine: OptimizationEngine;
  provider: ModelProviderId;
  baseUrl: string;
  confirmedApiHost?: string;
  mcpUrl: string;
  confirmedMcpHost?: string;
  model: string;
  encryptedCredential?: string;
  credentialScope?: CredentialScope;
}

export interface StoredSettings {
  schemaVersion: 5;
  activeRouteId: string;
  routes: StoredRoute[];
  apiKeyOnboardingCompleted: boolean;
  maxRequestsPerHour: number;
  dailyTokenBudget: number;
  maxOutputTokens: number;
  theme: ThemePreference;
}

export interface RuntimeSettings {
  routeId: string;
  routeName: string;
  engine: OptimizationEngine;
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiHost: string;
  mcpUrl: string;
  mcpHost: string;
  mcpAccessToken: string;
  maxRequestsPerHour: number;
  dailyTokenBudget: number;
  maxOutputTokens: number;
}

export type UsageLimitSettings = Pick<
  RuntimeSettings,
  "maxRequestsPerHour" | "dailyTokenBudget" | "maxOutputTokens"
>;

const providerIdSchema = z.enum(PROVIDER_IDS);
const credentialScopeSchema = z.strictObject({
  kind: z.enum(["direct-api-key", "mcp-access-token"]),
  provider: providerIdSchema,
  endpoint: z.string().min(1).max(2_048),
});
const storedRouteSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  engine: z.enum(["direct", "prompt-optimizer-mcp"]),
  provider: providerIdSchema,
  baseUrl: z.string().min(1).max(2_048),
  confirmedApiHost: z.string().min(1).max(253).optional(),
  mcpUrl: z.string().min(1).max(2_048),
  confirmedMcpHost: z.string().min(1).max(253).optional(),
  model: z.string().min(1).max(200),
  encryptedCredential: z.string().min(1).max(100_000).optional(),
  credentialScope: credentialScopeSchema.optional(),
});
const storedSettingsSchema = z.strictObject({
  schemaVersion: z.literal(5),
  activeRouteId: z.uuid(),
  routes: z.array(storedRouteSchema).min(1).max(40),
  apiKeyOnboardingCompleted: z.boolean(),
  maxRequestsPerHour: z.number().int().min(1).max(120),
  dailyTokenBudget: z.number().int().min(10_000).max(2_000_000),
  maxOutputTokens: z.number().int().min(256).max(16_384),
  theme: z.enum(["system", "light", "dark"]),
});

const previousSettingsV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    activeRouteId: z.uuid(),
    routes: z.array(storedRouteSchema).min(1).max(40),
    maxRequestsPerHour: z.number().int().min(1).max(120),
    dailyTokenBudget: z.number().int().min(10_000).max(2_000_000),
    maxOutputTokens: z.number().int().min(256).max(16_384),
    theme: z.enum(["system", "light", "dark"]),
  })
  .passthrough();

const previousSettingsV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    activeRouteId: z.uuid(),
    routes: z.array(storedRouteSchema).min(1).max(40),
    maxRequestsPerHour: z.number().int().min(1).max(120),
    dailyTokenBudget: z.number().int().min(10_000).max(2_000_000),
    maxOutputTokens: z.number().int().min(256).max(16_384),
  })
  .passthrough();

const previousSettingsV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    activeRouteId: z.uuid(),
    routes: z.array(storedRouteSchema).min(1).max(40),
    maxRequestsPerHour: z.number().int().min(1).max(120),
    dailyTokenBudget: z.number().int().min(10_000).max(2_000_000),
    maxOutputTokens: z.number().int().min(256).max(16_384),
  })
  .passthrough();

// Version 0.2.0 stored one connection directly on the settings object.
const legacySettingsSchema = z.object({
  engine: z.enum(["direct", "prompt-optimizer-mcp"]).optional(),
  baseUrl: z.string().max(2_048).optional(),
  model: z.string().max(200).optional(),
  encryptedApiKey: z.string().max(100_000).optional(),
  confirmedApiHost: z.string().max(253).optional(),
  mcpUrl: z.string().max(2_048).optional(),
  confirmedMcpHost: z.string().max(253).optional(),
  maxRequestsPerHour: z.number().int().min(1).max(120).optional(),
  dailyTokenBudget: z.number().int().min(10_000).max(2_000_000).optional(),
  maxOutputTokens: z.number().int().min(256).max(16_384).optional(),
});

const DEFAULT_LIMITS = {
  maxRequestsPerHour: 30,
  dailyTokenBudget: 200_000,
  maxOutputTokens: 4_096,
} as const;
export const DEFAULT_MCP_URL = "http://127.0.0.1:3000/mcp";
export const MAX_SETTINGS_FILE_BYTES = 5 * 1024 * 1024;

export function confirmedHost(
  endpoint: EndpointInfo,
  candidate?: string,
): string | undefined {
  return endpoint.requiresConfirmation &&
    candidate?.trim().toLowerCase() === endpoint.hostname
    ? endpoint.hostname
    : undefined;
}

function normalizeOrFallback(value: string | undefined, fallback: string): string {
  try {
    return inspectEndpoint(value || fallback).normalizedUrl;
  } catch {
    return fallback;
  }
}

function createDefaultRoute(): StoredRoute {
  const provider = getProviderDefinition("openai");
  return {
    id: randomUUID(),
    name: "OpenAI 默认路由",
    engine: "direct",
    provider: provider.id,
    baseUrl: provider.defaultBaseUrl,
    mcpUrl: DEFAULT_MCP_URL,
    model: provider.fallbackModels[0] || "gpt-4.1-mini",
  };
}

export function createDefaultSettings(): StoredSettings {
  const route = createDefaultRoute();
  return {
    schemaVersion: 5,
    activeRouteId: route.id,
    routes: [route],
    apiKeyOnboardingCompleted: false,
    ...DEFAULT_LIMITS,
    theme: "system",
  };
}

export function credentialScopeFor(route: StoredRoute): CredentialScope {
  return route.engine === "direct"
    ? {
        kind: "direct-api-key",
        provider: route.provider,
        endpoint: route.baseUrl,
      }
    : {
        kind: "mcp-access-token",
        provider: route.provider,
        endpoint: route.mcpUrl,
      };
}

export function hasScopedCredential(route: StoredRoute): boolean {
  const expected = credentialScopeFor(route);
  const actual = route.credentialScope;
  return Boolean(
    route.encryptedCredential &&
      actual &&
      actual.kind === expected.kind &&
      actual.provider === expected.provider &&
      actual.endpoint === expected.endpoint,
  );
}

function normalizeStoredRoute(route: StoredRoute): StoredRoute {
  const apiEndpoint = inspectEndpoint(route.baseUrl);
  const mcpEndpoint = inspectEndpoint(route.mcpUrl);
  const normalized: StoredRoute = {
    ...route,
    name: route.name.trim(),
    baseUrl: apiEndpoint.normalizedUrl,
    mcpUrl: mcpEndpoint.normalizedUrl,
    model: route.model.trim(),
    confirmedApiHost: confirmedHost(apiEndpoint, route.confirmedApiHost),
    confirmedMcpHost: confirmedHost(mcpEndpoint, route.confirmedMcpHost),
  };
  if (!hasScopedCredential(normalized)) {
    delete normalized.encryptedCredential;
    delete normalized.credentialScope;
  }
  return normalized;
}

function migratePreviousSettings(raw: unknown): StoredSettings | null {
  const v4 = previousSettingsV4Schema.safeParse(raw);
  if (v4.success) {
    return {
      schemaVersion: 5,
      activeRouteId: v4.data.activeRouteId,
      routes: v4.data.routes,
      apiKeyOnboardingCompleted: true,
      maxRequestsPerHour: v4.data.maxRequestsPerHour,
      dailyTokenBudget: v4.data.dailyTokenBudget,
      maxOutputTokens: v4.data.maxOutputTokens,
      theme: v4.data.theme,
    };
  }

  const v3 = previousSettingsV3Schema.safeParse(raw);
  const v2 = previousSettingsV2Schema.safeParse(raw);
  const previous = v3.success ? v3.data : v2.success ? v2.data : null;
  if (!previous) return null;
  return {
    schemaVersion: 5,
    activeRouteId: previous.activeRouteId,
    routes: previous.routes,
    apiKeyOnboardingCompleted: true,
    maxRequestsPerHour: previous.maxRequestsPerHour,
    dailyTokenBudget: previous.dailyTokenBudget,
    maxOutputTokens: previous.maxOutputTokens,
    theme: "system",
  };
}

function migrateLegacySettings(raw: unknown): StoredSettings | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("baseUrl" in raw || "mcpUrl" in raw || "encryptedApiKey" in raw)
  ) {
    return null;
  }
  const parsed = legacySettingsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const legacy = parsed.data;
  const fallbackRoute = createDefaultRoute();
  const baseUrl = normalizeOrFallback(legacy.baseUrl, fallbackRoute.baseUrl);
  const mcpUrl = normalizeOrFallback(legacy.mcpUrl, fallbackRoute.mcpUrl);
  const provider = inferProviderFromBaseUrl(baseUrl);
  const providerDefinition = getProviderDefinition(provider);
  const apiEndpoint = inspectEndpoint(baseUrl);
  const mcpEndpoint = inspectEndpoint(mcpUrl);
  const route: StoredRoute = {
    id: randomUUID(),
    name: `${providerDefinition.label} 默认路由`,
    engine: legacy.engine || "direct",
    provider,
    baseUrl,
    confirmedApiHost: confirmedHost(apiEndpoint, legacy.confirmedApiHost),
    mcpUrl,
    confirmedMcpHost: confirmedHost(mcpEndpoint, legacy.confirmedMcpHost),
    model: legacy.model?.trim() || fallbackRoute.model,
  };

  if (legacy.encryptedApiKey && route.engine === "direct") {
    route.encryptedCredential = legacy.encryptedApiKey;
    route.credentialScope = credentialScopeFor(route);
  }

  return {
    schemaVersion: 5,
    activeRouteId: route.id,
    routes: [route],
    apiKeyOnboardingCompleted: true,
    maxRequestsPerHour:
      legacy.maxRequestsPerHour ?? DEFAULT_LIMITS.maxRequestsPerHour,
    dailyTokenBudget:
      legacy.dailyTokenBudget ?? DEFAULT_LIMITS.dailyTokenBudget,
    maxOutputTokens: legacy.maxOutputTokens ?? DEFAULT_LIMITS.maxOutputTokens,
    theme: "system",
  };
}

function normalizeStoredSettings(settings: StoredSettings): StoredSettings {
  const routes = settings.routes.map(normalizeStoredRoute);
  const activeRouteId = routes.some((route) => route.id === settings.activeRouteId)
    ? settings.activeRouteId
    : routes[0]!.id;
  return { ...settings, routes, activeRouteId };
}

export function decodeStoredSettings(
  raw: unknown,
): { settings: StoredSettings; migrated: boolean } {
  try {
    const current = storedSettingsSchema.safeParse(raw);
    if (current.success) {
      return { settings: normalizeStoredSettings(current.data), migrated: false };
    }
    const migrated = migratePreviousSettings(raw) || migrateLegacySettings(raw);
    if (migrated) {
      return { settings: normalizeStoredSettings(migrated), migrated: true };
    }
  } catch {
    // A route with an invalid endpoint is also an invalid stored schema.
  }
  throw new JsonDocumentError("ERR_JSON_SCHEMA", "Invalid settings schema");
}
