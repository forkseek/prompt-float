import { describe, expect, it } from "vitest";
import type { SettingsInput } from "../../shared/types";
import {
  apiKeySetupInputSchema,
  assertTrustedIpcSender,
  isTrustedRendererUrl,
  optimizeRequestSchema,
  parseIpcPayload,
  settingsInputSchema,
  themePreferenceSchema,
} from "./validation";

const validSettings: SettingsInput = {
  route: {
    name: "测试路由",
    engine: "direct",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    confirmedApiHost: "api.example.com",
    model: "test-model",
    mcpUrl: "http://127.0.0.1:3000/mcp",
  },
  maxRequestsPerHour: 30,
  dailyTokenBudget: 200_000,
  maxOutputTokens: 4_096,
};

describe("IPC validation", () => {
  it("accepts only strict onboarding payloads for verified providers", () => {
    expect(
      parseIpcPayload(apiKeySetupInputSchema, {
        provider: "openai",
        credential: "test-key",
        confirmedApiHost: "api.openai.com",
      }),
    ).toEqual({
      provider: "openai",
      credential: "test-key",
      confirmedApiHost: "api.openai.com",
    });
    expect(() =>
      parseIpcPayload(apiKeySetupInputSchema, {
        provider: "openai-compatible",
        credential: "test-key",
        confirmedApiHost: "api.example.com",
      }),
    ).toThrow("请求数据格式不正确");
    expect(() =>
      parseIpcPayload(apiKeySetupInputSchema, {
        provider: "openai",
        credential: "test-key",
        confirmedApiHost: "api.openai.com",
        url: "https://evil.example",
      }),
    ).toThrow("请求数据格式不正确");
  });

  it("accepts only supported appearance themes", () => {
    expect(parseIpcPayload(themePreferenceSchema, "system")).toBe("system");
    expect(parseIpcPayload(themePreferenceSchema, "light")).toBe("light");
    expect(parseIpcPayload(themePreferenceSchema, "dark")).toBe("dark");
    expect(() => parseIpcPayload(themePreferenceSchema, "neon")).toThrow(
      "请求数据格式不正确",
    );
  });

  it("accepts a valid settings payload and rejects unknown fields", () => {
    expect(parseIpcPayload(settingsInputSchema, validSettings)).toEqual(
      validSettings,
    );
    expect(() =>
      parseIpcPayload(settingsInputSchema, {
        ...validSettings,
        injected: true,
      }),
    ).toThrow("请求数据格式不正确");
    expect(() =>
      parseIpcPayload(settingsInputSchema, {
        ...validSettings,
        route: { ...validSettings.route, injected: true },
      }),
    ).toThrow("请求数据格式不正确");
    const retiredPreference = ["always", "On", "Top"].join("");
    expect(() =>
      parseIpcPayload(settingsInputSchema, {
        ...validSettings,
        [retiredPreference]: true,
      }),
    ).toThrow("请求数据格式不正确");
  });

  it("enforces prompt length and iterate requirements", () => {
    expect(() =>
      parseIpcPayload(optimizeRequestSchema, {
        requestId: crypto.randomUUID(),
        mode: "iterate",
        prompt: "原提示词",
      }),
    ).toThrow();
    expect(() =>
      parseIpcPayload(optimizeRequestSchema, {
        requestId: crypto.randomUUID(),
        mode: "user",
        prompt: "x".repeat(50_001),
      }),
    ).toThrow();
  });

  it("matches only the expected renderer URL", () => {
    expect(
      isTrustedRendererUrl(
        "http://127.0.0.1:5173/",
        "http://127.0.0.1:5173",
      ),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(
        "http://evil.example/",
        "http://127.0.0.1:5173/",
      ),
    ).toBe(false);
  });

  it("requires the main window webContents and main frame", () => {
    const frame = { url: "file:///C:/app/dist/index.html" };
    const webContents = {
      mainFrame: frame,
      isDestroyed: () => false,
    };
    const window = {
      isDestroyed: () => false,
      webContents,
    };
    const event = { sender: webContents, senderFrame: frame };

    expect(() =>
      assertTrustedIpcSender(
        event as never,
        window as never,
        "file:///C:/app/dist/index.html",
      ),
    ).not.toThrow();
    expect(() =>
      assertTrustedIpcSender(
        { ...event, senderFrame: { url: frame.url } } as never,
        window as never,
        "file:///C:/app/dist/index.html",
      ),
    ).toThrow("已拒绝不可信页面的请求");
  });
});
