import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RouteInput, SettingsInput } from "../../shared/types";
import {
  SettingsRepository,
  type SecureStorageAdapter,
} from "./settingsRepository";

const temporaryDirectories: string[] = [];

const fakeSecureStorage: SecureStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`cipher:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").slice("cipher:".length),
};

async function createRepository() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-settings-"),
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "settings.json");
  return {
    filePath,
    repository: new SettingsRepository(filePath, fakeSecureStorage),
  };
}

function routeInput(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    name: "本地测试路由",
    engine: "direct",
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:4010/v1",
    model: "local-test-model",
    mcpUrl: "http://127.0.0.1:3000/mcp",
    ...overrides,
  };
}

function settingsInput(
  routeOverrides: Partial<RouteInput> = {},
  globalOverrides: Partial<Omit<SettingsInput, "route">> = {},
): SettingsInput {
  return {
    route: routeInput(routeOverrides),
    maxRequestsPerHour: 12,
    dailyTokenBudget: 100_000,
    maxOutputTokens: 2_048,
    ...globalOverrides,
  };
}

async function defaultRouteId(repository: SettingsRepository): Promise<string> {
  return (await repository.getPublicSettings()).activeRouteId;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("settings repository", () => {
  it("starts onboarding only for new storage and saves official provider keys atomically", async () => {
    const { filePath, repository } = await createRepository();
    const initial = await repository.getPublicSettings();
    expect(initial.apiKeyOnboardingCompleted).toBe(false);

    const openai = await repository.saveProviderApiKey({
      provider: "openai",
      credential: "openai-onboarding-key",
      confirmedApiHost: "api.openai.com",
    });
    expect(openai.apiKeyOnboardingCompleted).toBe(true);
    expect(openai.routes).toHaveLength(1);
    expect(openai.routes[0]).toMatchObject({
      id: openai.activeRouteId,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      hasCredential: true,
    });
    expect(JSON.stringify(openai)).not.toContain("openai-onboarding-key");
    expect(await fs.readFile(filePath, "utf8")).not.toContain(
      "openai-onboarding-key",
    );

    const anthropic = await repository.saveProviderApiKey({
      provider: "anthropic",
      credential: "anthropic-onboarding-key",
      confirmedApiHost: "api.anthropic.com",
    });
    expect(anthropic.routes).toHaveLength(2);
    expect(anthropic.routes.find((route) => route.id === anthropic.activeRouteId))
      .toMatchObject({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        hasCredential: true,
      });
    expect((await repository.getRuntimeSettings()).apiKey).toBe(
      "anthropic-onboarding-key",
    );
  });

  it("encrypts route credentials at rest and never exposes them publicly", async () => {
    const { filePath, repository } = await createRepository();
    const id = await defaultRouteId(repository);
    const saved = await repository.saveSettings(
      settingsInput({ id, credential: "top-secret-key" }),
    );

    expect(saved.routes.find((route) => route.id === id)?.hasCredential).toBe(
      true,
    );
    expect(saved.apiKeyOnboardingCompleted).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("top-secret-key");
    expect(await fs.readFile(filePath, "utf8")).not.toContain("top-secret-key");
    expect((await repository.getRuntimeSettings()).apiKey).toBe(
      "top-secret-key",
    );

    const repositoryAfterRestart = new SettingsRepository(
      filePath,
      fakeSecureStorage,
    );
    const reloaded = await repositoryAfterRestart.getPublicSettings();
    expect(reloaded.routes.find((route) => route.id === id)?.hasCredential).toBe(
      true,
    );
    expect((await repositoryAfterRestart.getRuntimeSettings()).apiKey).toBe(
      "top-secret-key",
    );
  });

  it("flags an unreadable saved key without changing it and accepts a replacement", async () => {
    const { filePath, repository } = await createRepository();
    const id = await defaultRouteId(repository);
    await repository.saveSettings(
      settingsInput({ id, credential: "legacy-key" }),
    );
    const originalFile = await fs.readFile(filePath, "utf8");

    const unreadableStorage: SecureStorageAdapter = {
      ...fakeSecureStorage,
      decryptString: (value) => {
        if (value.toString("utf8") === "cipher:legacy-key") {
          throw new Error("old encryption context unavailable");
        }
        return fakeSecureStorage.decryptString(value);
      },
    };
    const restarted = new SettingsRepository(filePath, unreadableStorage);
    const publicSettings = await restarted.getPublicSettings();
    expect(publicSettings.routes[0]).toMatchObject({
      id,
      hasCredential: false,
      credentialNeedsReentry: true,
    });
    expect(JSON.stringify(publicSettings)).not.toContain("legacy-key");
    expect(await fs.readFile(filePath, "utf8")).toBe(originalFile);
    await expect(restarted.getRuntimeSettings()).rejects.toThrow(
      "已保存的凭据无法解密",
    );

    const replaced = await restarted.saveSettings(
      settingsInput({ id, credential: "replacement-key" }),
    );
    expect(replaced.routes[0]).toMatchObject({
      id,
      hasCredential: true,
      credentialNeedsReentry: false,
    });
    expect((await restarted.getRuntimeSettings()).apiKey).toBe("replacement-key");
    expect(await fs.readFile(filePath, "utf8")).not.toContain("replacement-key");
  });

  it("does not reuse a saved credential after the provider endpoint changes", async () => {
    const { repository } = await createRepository();
    const id = await defaultRouteId(repository);
    await repository.saveSettings(settingsInput({ id, credential: "retained" }));

    const changedEndpoint = settingsInput({
      id,
      baseUrl: "http://127.0.0.1:4011/v1",
    });
    await expect(repository.getRouteTestSettings(changedEndpoint)).rejects.toThrow(
      "请填写该供应商的 API Key",
    );

    const saved = await repository.saveSettings(changedEndpoint);
    expect(saved.routes.find((route) => route.id === id)?.hasCredential).toBe(
      false,
    );
  });

  it("persists multiple routes, activates a selected route, and stores MCP tokens separately", async () => {
    const { repository } = await createRepository();
    const firstId = await defaultRouteId(repository);
    await repository.saveSettings(
      settingsInput({ id: firstId, name: "OpenAI 兼容", credential: "first-key" }),
    );
    const withMcp = await repository.saveSettings(
      settingsInput({
        name: "本地 MCP",
        engine: "prompt-optimizer-mcp",
        provider: "deepseek",
        model: "deepseek-chat",
        mcpUrl: "http://127.0.0.1:4012/mcp",
        credential: "mcp-token",
      }),
    );
    const mcpRoute = withMcp.routes.find((route) => route.name === "本地 MCP");
    expect(mcpRoute?.hasCredential).toBe(true);
    expect(withMcp.routes).toHaveLength(2);
    expect(await repository.getRuntimeSettings()).toMatchObject({
      routeId: mcpRoute?.id,
      engine: "prompt-optimizer-mcp",
      provider: "deepseek",
      model: "deepseek-chat",
      mcpUrl: "http://127.0.0.1:4012/mcp",
      mcpAccessToken: "mcp-token",
    });

    const activated = await repository.activateRoute(firstId);
    expect(activated.activeRouteId).toBe(firstId);
    expect(await repository.getRuntimeSettings()).toMatchObject({
      routeId: firstId,
      engine: "direct",
      provider: "openai-compatible",
      model: "local-test-model",
      baseUrl: "http://127.0.0.1:4010/v1",
      apiKey: "first-key",
    });
  });

  it("requires a confirmed remote endpoint before a route can be saved", async () => {
    const { repository } = await createRepository();
    const id = await defaultRouteId(repository);
    await expect(
      repository.saveSettings(
        settingsInput({ id, baseUrl: "https://api.example.com/v1" }),
      ),
    ).rejects.toThrow("请先确认数据发送域名");

    await expect(
      repository.saveSettings(
        settingsInput({
          id,
          baseUrl: "https://api.example.com/v1",
          confirmedApiHost: "api.example.com",
        }),
      ),
    ).resolves.toMatchObject({
      activeRouteId: id,
    });
  });

  it("keeps the active route unchanged when activation fails", async () => {
    const { repository } = await createRepository();
    const activeRouteId = await defaultRouteId(repository);
    await repository.saveSettings(
      settingsInput({ id: activeRouteId, credential: "stable-key" }),
    );

    await expect(repository.activateRoute(crypto.randomUUID())).rejects.toThrow();

    const settings = await repository.getPublicSettings();
    expect(settings.activeRouteId).toBe(activeRouteId);
    await expect(repository.getRuntimeSettings()).resolves.toMatchObject({
      routeId: activeRouteId,
      apiKey: "stable-key",
    });
  });

  it("migrates v2 settings, adds the system theme and removes the retired window preference", async () => {
    const { filePath, repository } = await createRepository();
    const routeId = crypto.randomUUID();
    const retiredPreference = ["always", "On", "Top"].join("");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 2,
        activeRouteId: routeId,
        routes: [
          {
            id: routeId,
            name: "v2 路由",
            engine: "direct",
            provider: "openai-compatible",
            baseUrl: "http://127.0.0.1:4010/v1",
            mcpUrl: "http://127.0.0.1:3000/mcp",
            model: "v2-model",
          },
        ],
        [retiredPreference]: true,
        maxRequestsPerHour: 30,
        dailyTokenBudget: 200_000,
        maxOutputTokens: 4_096,
      }),
      "utf8",
    );

    const loaded = await repository.getPublicSettings();
    expect(loaded.activeRouteId).toBe(routeId);
    expect(loaded.routes[0]?.model).toBe("v2-model");

    const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(persisted.schemaVersion).toBe(5);
    expect(persisted.apiKeyOnboardingCompleted).toBe(true);
    expect(persisted.theme).toBe("system");
    expect(persisted).not.toHaveProperty(retiredPreference);
  });

  it("persists the selected theme without changing routes or encrypted credentials", async () => {
    const { filePath, repository } = await createRepository();
    const id = await defaultRouteId(repository);
    await repository.saveSettings(
      settingsInput({ id, credential: "theme-safe-key" }),
    );

    const themed = await repository.setThemePreference("light");
    expect(themed.theme).toBe("light");
    expect(themed.activeRouteId).toBe(id);
    expect(themed.routes.find((route) => route.id === id)?.hasCredential).toBe(
      true,
    );

    const repositoryAfterRestart = new SettingsRepository(
      filePath,
      fakeSecureStorage,
    );
    expect((await repositoryAfterRestart.getPublicSettings()).theme).toBe(
      "light",
    );
    expect((await repositoryAfterRestart.getRuntimeSettings()).apiKey).toBe(
      "theme-safe-key",
    );
  });

  it("migrates v3 settings to the system theme without losing the active route", async () => {
    const { filePath, repository } = await createRepository();
    const routeId = crypto.randomUUID();
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 3,
        activeRouteId: routeId,
        routes: [
          {
            id: routeId,
            name: "v3 路由",
            engine: "direct",
            provider: "openai-compatible",
            baseUrl: "http://127.0.0.1:4010/v1",
            mcpUrl: "http://127.0.0.1:3000/mcp",
            model: "v3-model",
          },
        ],
        maxRequestsPerHour: 30,
        dailyTokenBudget: 200_000,
        maxOutputTokens: 4_096,
      }),
      "utf8",
    );

    const loaded = await repository.getPublicSettings();
    expect(loaded).toMatchObject({
      activeRouteId: routeId,
      theme: "system",
    });
    expect(loaded.routes[0]?.model).toBe("v3-model");
    expect(
      JSON.parse(await fs.readFile(filePath, "utf8")).schemaVersion,
    ).toBe(5);
    expect(
      JSON.parse(await fs.readFile(filePath, "utf8"))
        .apiKeyOnboardingCompleted,
    ).toBe(true);
  });

  it("migrates v4 settings without showing first-launch onboarding to existing users", async () => {
    const { filePath, repository } = await createRepository();
    const routeId = crypto.randomUUID();
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 4,
        activeRouteId: routeId,
        routes: [
          {
            id: routeId,
            name: "v4 路由",
            engine: "direct",
            provider: "openai-compatible",
            baseUrl: "http://127.0.0.1:4010/v1",
            mcpUrl: "http://127.0.0.1:3000/mcp",
            model: "v4-model",
          },
        ],
        maxRequestsPerHour: 30,
        dailyTokenBudget: 200_000,
        maxOutputTokens: 4_096,
        theme: "dark",
      }),
      "utf8",
    );

    const loaded = await repository.getPublicSettings();
    expect(loaded).toMatchObject({
      activeRouteId: routeId,
      apiKeyOnboardingCompleted: true,
      theme: "dark",
    });
    const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(persisted.schemaVersion).toBe(5);
    expect(persisted.apiKeyOnboardingCompleted).toBe(true);
  });

  it("migrates the legacy one-route schema without exposing the old key", async () => {
    const { filePath, repository } = await createRepository();
    const encryptedApiKey = fakeSecureStorage
      .encryptString("legacy-key")
      .toString("base64");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        engine: "direct",
        baseUrl: "http://127.0.0.1:4010/v1",
        model: "legacy-model",
        encryptedApiKey,
        mcpUrl: "http://127.0.0.1:3000/mcp",
        maxRequestsPerHour: 30,
        dailyTokenBudget: 200_000,
        maxOutputTokens: 4_096,
      }),
      "utf8",
    );

    const loaded = await repository.getPublicSettings();
    expect(loaded.routes).toHaveLength(1);
    expect(loaded.routes[0]?.model).toBe("legacy-model");
    expect(loaded.routes[0]?.hasCredential).toBe(true);
    expect(loaded.apiKeyOnboardingCompleted).toBe(true);
    expect(JSON.stringify(loaded)).not.toContain("legacy-key");
    expect((await repository.getRuntimeSettings()).apiKey).toBe("legacy-key");
  });

  it("blocks malformed storage without a valid backup", async () => {
    const { filePath, repository } = await createRepository();
    await fs.writeFile(filePath, "{not-json", "utf8");
    await expect(repository.getPublicSettings()).rejects.toThrow("设置文件不可用");
    expect(await fs.readFile(filePath, "utf8")).toBe("{not-json");
  });

  it("serializes concurrent updates and keeps a previous revision", async () => {
    const { filePath, repository } = await createRepository();
    const id = await defaultRouteId(repository);
    await Promise.all([
      repository.saveSettings(
        settingsInput({ id, model: "first", credential: "first-key" }),
      ),
      repository.saveSettings(
        settingsInput({ id, model: "second", credential: "second-key" }),
      ),
    ]);
    const runtime = await repository.getRuntimeSettings();
    expect(runtime.model).toBe("second");
    expect(runtime.apiKey).toBe("second-key");
    const files = await fs.readdir(path.dirname(filePath));
    expect(files).toEqual(["settings.json", "settings.json.bak"]);
  });

  it("recovers a saved encrypted route from a valid backup", async () => {
    const { filePath, repository } = await createRepository();
    const id = await defaultRouteId(repository);
    await repository.saveSettings(settingsInput({ id, credential: "recovery-key" }));
    await repository.setThemePreference("dark");
    await fs.writeFile(filePath, "{broken", "utf8");

    const restarted = new SettingsRepository(filePath, fakeSecureStorage);
    expect((await restarted.getPublicSettings()).routes[0]?.hasCredential).toBe(true);
    expect((await restarted.getRuntimeSettings()).apiKey).toBe("recovery-key");
    expect((await fs.readdir(path.dirname(filePath))).some((name) =>
      name.startsWith("settings.json.corrupt-"),
    )).toBe(true);
  });
});
