import type {
  BrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import {
  API_KEY_PROVIDER_IDS,
  PROVIDER_IDS,
} from "../../shared/providers";
import type {
  ApiKeySetupInput,
  OptimizeRequest,
  RouteInput,
  SettingsInput,
} from "../../shared/types";
import { PublicError } from "../services/publicError";

export const routeInputSchema: z.ZodType<RouteInput> = z.strictObject({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  engine: z.enum(["direct", "prompt-optimizer-mcp"]),
  provider: z.enum(PROVIDER_IDS),
  baseUrl: z.string().trim().min(1).max(2_048),
  model: z.string().trim().min(1).max(200),
  credential: z.string().trim().min(1).max(10_000).optional(),
  clearCredential: z.boolean().optional(),
  confirmedApiHost: z.string().trim().min(1).max(253).optional(),
  mcpUrl: z.string().trim().min(1).max(2_048),
  confirmedMcpHost: z.string().trim().min(1).max(253).optional(),
});

export const settingsInputSchema: z.ZodType<SettingsInput> = z.strictObject({
  route: routeInputSchema,
  maxRequestsPerHour: z.number().int().min(1).max(120),
  dailyTokenBudget: z.number().int().min(10_000).max(2_000_000),
  maxOutputTokens: z.number().int().min(256).max(16_384),
});

export const apiKeySetupInputSchema: z.ZodType<ApiKeySetupInput> =
  z.strictObject({
    provider: z.enum(API_KEY_PROVIDER_IDS),
    credential: z.string().trim().min(1).max(10_000),
    confirmedApiHost: z.string().trim().min(1).max(253),
  });

export const optimizeRequestSchema: z.ZodType<OptimizeRequest> = z
  .strictObject({
    requestId: z.uuid(),
    mode: z.enum(["user", "system", "iterate"]),
    prompt: z.string().trim().min(1).max(50_000),
    requirements: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine(
    (request) => request.mode !== "iterate" || Boolean(request.requirements),
    { message: "迭代优化必须填写要求" },
  );

export const requestIdSchema = z.uuid();
export const routeIdSchema = z.uuid();
export const apiKeyProviderIdSchema = z.enum(API_KEY_PROVIDER_IDS);
export const themePreferenceSchema = z.enum(["system", "light", "dark"]);
export const clipboardTextSchema = z.string().max(100_000);

export function parseIpcPayload<T>(
  schema: z.ZodType<T>,
  payload: unknown,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new PublicError("请求数据格式不正确");
  }
  return parsed.data;
}

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent;

export function canonicalRendererUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function isTrustedRendererUrl(
  actualUrl: string,
  expectedUrl: string,
): boolean {
  const actual = canonicalRendererUrl(actualUrl);
  const expected = canonicalRendererUrl(expectedUrl);
  return Boolean(actual && expected && actual === expected);
}

export function assertTrustedIpcSender(
  event: IpcEvent,
  window: BrowserWindow | null,
  expectedRendererUrl: string,
): void {
  const frame = event.senderFrame;
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    !frame ||
    frame !== window.webContents.mainFrame ||
    !isTrustedRendererUrl(frame.url, expectedRendererUrl)
  ) {
    throw new PublicError("已拒绝不可信页面的请求");
  }
}
