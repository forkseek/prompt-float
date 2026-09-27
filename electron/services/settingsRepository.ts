import { randomUUID } from "node:crypto";
import {
  JsonStorageError,
  loadValidatedJsonFile,
  writeJsonFileRecoverably,
} from "../infrastructure/jsonFile";
import { SerialTaskQueue } from "../infrastructure/serialTaskQueue";
import { getProviderDefinition } from "../../shared/providers";
import type {
  ApiKeySetupInput,
  ModelRoute,
  PublicSettings,
  RouteInput,
  SettingsInput,
  ThemePreference,
} from "../../shared/types";
import {
  assertEndpointConfirmed,
  inspectEndpoint,
} from "./endpointPolicy";
import { PublicError } from "./publicError";
import {
  MAX_SETTINGS_FILE_BYTES,
  DEFAULT_MCP_URL,
  confirmedHost,
  createDefaultSettings,
  credentialScopeFor,
  decodeStoredSettings,
  hasScopedCredential,
  type RuntimeSettings,
  type StoredRoute,
  type StoredSettings,
  type UsageLimitSettings,
} from "./settingsDocument";

export type { RuntimeSettings, UsageLimitSettings } from "./settingsDocument";

export interface SecureStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

type CredentialStatus = "missing" | "ready" | "unreadable";

function routeToPublic(route: StoredRoute, credentialStatus: CredentialStatus): ModelRoute {
  const apiEndpoint = inspectEndpoint(route.baseUrl);
  const mcpEndpoint = inspectEndpoint(route.mcpUrl);
  return {
    id: route.id,
    name: route.name,
    engine: route.engine,
    provider: route.provider,
    baseUrl: route.baseUrl,
    apiHost: apiEndpoint.displayHost,
    confirmedApiHost: route.confirmedApiHost,
    mcpUrl: route.mcpUrl,
    mcpHost: mcpEndpoint.displayHost,
    confirmedMcpHost: route.confirmedMcpHost,
    model: route.model,
    hasCredential: credentialStatus === "ready",
    credentialNeedsReentry: credentialStatus === "unreadable",
  };
}

function settingsToPublic(
  settings: StoredSettings,
  credentialStatusFor: (route: StoredRoute) => CredentialStatus,
): PublicSettings {
  return {
    activeRouteId: settings.activeRouteId,
    routes: settings.routes.map((route) =>
      routeToPublic(route, credentialStatusFor(route)),
    ),
    apiKeyOnboardingCompleted: settings.apiKeyOnboardingCompleted,
    maxRequestsPerHour: settings.maxRequestsPerHour,
    dailyTokenBudget: settings.dailyTokenBudget,
    maxOutputTokens: settings.maxOutputTokens,
    theme: settings.theme,
  };
}

function validateLimits(input: SettingsInput): void {
  if (
    !Number.isInteger(input.maxRequestsPerHour) ||
    input.maxRequestsPerHour < 1 ||
    input.maxRequestsPerHour > 120 ||
    !Number.isInteger(input.dailyTokenBudget) ||
    input.dailyTokenBudget < 10_000 ||
    input.dailyTokenBudget > 2_000_000 ||
    !Number.isInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 256 ||
    input.maxOutputTokens > 16_384
  ) {
    throw new PublicError("请求上限或 token 预算设置不正确");
  }
}

function normalizeRouteInput(input: RouteInput, id: string): StoredRoute {
  const name = input.name.trim();
  const model = input.model.trim();
  if (!name) throw new PublicError("路由名称不能为空");
  if (!model) throw new PublicError("模型名称不能为空");

  // Resolves the provider early so an invalid provider never reaches storage.
  getProviderDefinition(input.provider);
  const apiEndpoint = inspectEndpoint(input.baseUrl);
  const mcpEndpoint = inspectEndpoint(input.mcpUrl);
  if (input.engine === "direct") {
    assertEndpointConfirmed(apiEndpoint, input.confirmedApiHost);
  } else {
    assertEndpointConfirmed(mcpEndpoint, input.confirmedMcpHost);
  }

  return {
    id,
    name,
    engine: input.engine,
    provider: input.provider,
    baseUrl: apiEndpoint.normalizedUrl,
    confirmedApiHost: confirmedHost(apiEndpoint, input.confirmedApiHost),
    mcpUrl: mcpEndpoint.normalizedUrl,
    confirmedMcpHost: confirmedHost(mcpEndpoint, input.confirmedMcpHost),
    model,
  };
}

export class SettingsRepository {
  private readonly operations = new SerialTaskQueue();
  private transientSettings: StoredSettings | undefined;

  constructor(
    private readonly filePath: string,
    private readonly secureStorage: SecureStorageAdapter,
    private readonly onWarning: (message: string) => void = () => undefined,
  ) {}

  private async readStoredSettings(): Promise<StoredSettings> {
    let loaded;
    try {
      loaded = await loadValidatedJsonFile(
        this.filePath,
        MAX_SETTINGS_FILE_BYTES,
        decodeStoredSettings,
        true,
      );
    } catch (error) {
      const code = error instanceof JsonStorageError
        ? error.primaryCode
        : "ERR_JSON_IO";
      this.onWarning(`设置文件不可用，已阻止覆盖（${code}）`);
      throw new PublicError("设置文件不可用，已保留原文件并停止写入；请检查备份或联系维护人员");
    }
    if (loaded.status === "missing") {
      this.transientSettings ||= createDefaultSettings();
      return this.transientSettings;
    }
    if (loaded.status === "recovered") {
      this.onWarning("设置文件已从有效备份恢复，损坏的原文件已保留");
    }
    const { settings, migrated } = loaded.value;
    if (migrated) {
      await this.writeStoredSettings(settings);
    } else {
      this.transientSettings = settings;
    }
    return settings;
  }

  private async writeStoredSettings(settings: StoredSettings): Promise<void> {
    await writeJsonFileRecoverably(this.filePath, settings);
    this.transientSettings = settings;
  }

  private getActiveRoute(settings: StoredSettings): StoredRoute {
    return (
      settings.routes.find((route) => route.id === settings.activeRouteId) ||
      settings.routes[0]!
    );
  }

  private decryptCredential(route: StoredRoute): string {
    if (!hasScopedCredential(route)) return "";
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new PublicError("当前系统无法解密已保存的凭据");
    }
    try {
      return this.secureStorage.decryptString(
        Buffer.from(route.encryptedCredential!, "base64"),
      );
    } catch {
      throw new PublicError("已保存的凭据无法解密，请重新填写");
    }
  }

  private credentialStatus(route: StoredRoute): CredentialStatus {
    if (!hasScopedCredential(route)) return "missing";
    try {
      return this.decryptCredential(route) ? "ready" : "unreadable";
    } catch {
      // Do not expose or discard the original ciphertext. The user can replace it.
      return "unreadable";
    }
  }

  private toPublic(settings: StoredSettings): PublicSettings {
    return settingsToPublic(settings, (route) => this.credentialStatus(route));
  }

  private runtimeSettings(
    route: StoredRoute,
    settings: Pick<
      StoredSettings,
      | "maxRequestsPerHour"
      | "dailyTokenBudget"
      | "maxOutputTokens"
    >,
    credential: string,
  ): RuntimeSettings {
    const apiEndpoint = inspectEndpoint(route.baseUrl);
    const mcpEndpoint = inspectEndpoint(route.mcpUrl);
    if (route.engine === "direct") {
      assertEndpointConfirmed(apiEndpoint, route.confirmedApiHost);
      if (!credential) throw new PublicError("请填写该供应商的 API Key");
    } else {
      assertEndpointConfirmed(mcpEndpoint, route.confirmedMcpHost);
    }
    return {
      routeId: route.id,
      routeName: route.name,
      engine: route.engine,
      provider: route.provider,
      baseUrl: route.baseUrl,
      model: route.model,
      apiKey: route.engine === "direct" ? credential : "",
      apiHost: apiEndpoint.displayHost,
      mcpUrl: route.mcpUrl,
      mcpHost: mcpEndpoint.displayHost,
      mcpAccessToken: route.engine === "prompt-optimizer-mcp" ? credential : "",
      maxRequestsPerHour: settings.maxRequestsPerHour,
      dailyTokenBudget: settings.dailyTokenBudget,
      maxOutputTokens: settings.maxOutputTokens,
    };
  }

  async getPublicSettings(): Promise<PublicSettings> {
    return this.operations.run(async () =>
      this.toPublic(await this.readStoredSettings()),
    );
  }

  async saveSettings(input: SettingsInput): Promise<PublicSettings> {
    return this.operations.run(async () => {
      validateLimits(input);
      const settings = await this.readStoredSettings();
      const requestedId = input.route.id;
      const existing = requestedId
        ? settings.routes.find((route) => route.id === requestedId)
        : undefined;
      if (requestedId && !existing) {
        throw new PublicError("该路由不存在或已删除，请重新创建");
      }
      if (!existing && settings.routes.length >= 40) {
        throw new PublicError("最多可保存 40 条模型路由");
      }

      const route = normalizeRouteInput(input.route, existing?.id || randomUUID());
      const incomingCredential = input.route.credential?.trim();
      if (input.route.clearCredential) {
        // Explicit removal takes precedence over a stale form value.
      } else if (incomingCredential) {
        if (!this.secureStorage.isEncryptionAvailable()) {
          throw new PublicError("当前系统无法安全保存凭据");
        }
        route.encryptedCredential = this.secureStorage
          .encryptString(incomingCredential)
          .toString("base64");
        route.credentialScope = credentialScopeFor(route);
      } else if (existing && hasScopedCredential(existing)) {
        const nextScope = credentialScopeFor(route);
        const oldScope = existing.credentialScope!;
        if (
          nextScope.kind === oldScope.kind &&
          nextScope.provider === oldScope.provider &&
          nextScope.endpoint === oldScope.endpoint
        ) {
          route.encryptedCredential = existing.encryptedCredential;
          route.credentialScope = existing.credentialScope;
        }
      }

      const routes = existing
        ? settings.routes.map((candidate) =>
            candidate.id === route.id ? route : candidate,
          )
        : [...settings.routes, route];
      const next: StoredSettings = {
        schemaVersion: 5,
        activeRouteId: route.id,
        routes,
        apiKeyOnboardingCompleted:
          settings.apiKeyOnboardingCompleted ||
          (route.engine === "direct" && hasScopedCredential(route)),
        maxRequestsPerHour: input.maxRequestsPerHour,
        dailyTokenBudget: input.dailyTokenBudget,
        maxOutputTokens: input.maxOutputTokens,
        theme: settings.theme,
      };
      await this.writeStoredSettings(next);
      return this.toPublic(next);
    });
  }

  async saveProviderApiKey(input: ApiKeySetupInput): Promise<PublicSettings> {
    return this.operations.run(async () => {
      const credential = input.credential.trim();
      if (!credential || credential.length > 10_000) {
        throw new PublicError("API Key 格式不正确");
      }

      const provider = getProviderDefinition(input.provider);
      if (!provider.apiKeyUrl) {
        throw new PublicError("该供应商没有可用的官方 API Key 配置入口");
      }
      if (!this.secureStorage.isEncryptionAvailable()) {
        throw new PublicError("当前系统无法安全保存凭据");
      }

      const settings = await this.readStoredSettings();
      const apiEndpoint = inspectEndpoint(provider.defaultBaseUrl);
      assertEndpointConfirmed(apiEndpoint, input.confirmedApiHost);
      const existing = settings.routes.find(
        (route) =>
          route.engine === "direct" &&
          route.provider === provider.id &&
          route.baseUrl === apiEndpoint.normalizedUrl,
      );
      if (!existing && settings.routes.length >= 40) {
        throw new PublicError("最多可保存 40 条模型路由");
      }

      const model = existing?.model || provider.fallbackModels[0];
      if (!model) {
        throw new PublicError("该供应商没有可用的默认模型");
      }
      const route = normalizeRouteInput(
        {
          id: existing?.id,
          name: existing?.name || `${provider.label} 默认路由`,
          engine: "direct",
          provider: provider.id,
          baseUrl: provider.defaultBaseUrl,
          confirmedApiHost: input.confirmedApiHost,
          model,
          mcpUrl: existing?.mcpUrl || DEFAULT_MCP_URL,
          confirmedMcpHost: existing?.confirmedMcpHost,
        },
        existing?.id || randomUUID(),
      );
      route.encryptedCredential = this.secureStorage
        .encryptString(credential)
        .toString("base64");
      route.credentialScope = credentialScopeFor(route);

      const routes = existing
        ? settings.routes.map((candidate) =>
            candidate.id === route.id ? route : candidate,
          )
        : [...settings.routes, route];
      const next: StoredSettings = {
        ...settings,
        schemaVersion: 5,
        activeRouteId: route.id,
        routes,
        apiKeyOnboardingCompleted: true,
      };
      await this.writeStoredSettings(next);
      return this.toPublic(next);
    });
  }

  async setThemePreference(theme: ThemePreference): Promise<PublicSettings> {
    return this.operations.run(async () => {
      const settings = await this.readStoredSettings();
      const next: StoredSettings = { ...settings, theme };
      await this.writeStoredSettings(next);
      return this.toPublic(next);
    });
  }

  async activateRoute(routeId: string): Promise<PublicSettings> {
    return this.operations.run(async () => {
      const settings = await this.readStoredSettings();
      const route = settings.routes.find((candidate) => candidate.id === routeId);
      if (!route) throw new PublicError("找不到要切换的模型路由");
      if (route.engine === "direct") {
        assertEndpointConfirmed(
          inspectEndpoint(route.baseUrl),
          route.confirmedApiHost,
        );
      } else {
        assertEndpointConfirmed(
          inspectEndpoint(route.mcpUrl),
          route.confirmedMcpHost,
        );
      }
      const next = { ...settings, activeRouteId: route.id };
      await this.writeStoredSettings(next);
      return this.toPublic(next);
    });
  }

  async deleteRoute(routeId: string): Promise<PublicSettings> {
    return this.operations.run(async () => {
      const settings = await this.readStoredSettings();
      if (settings.routes.length === 1) {
        throw new PublicError("至少需要保留一条模型路由");
      }
      const routes = settings.routes.filter((route) => route.id !== routeId);
      if (routes.length === settings.routes.length) {
        throw new PublicError("找不到要删除的模型路由");
      }
      const next: StoredSettings = {
        ...settings,
        routes,
        activeRouteId:
          settings.activeRouteId === routeId
            ? routes[0]!.id
            : settings.activeRouteId,
      };
      await this.writeStoredSettings(next);
      return this.toPublic(next);
    });
  }

  async getRuntimeSettings(): Promise<RuntimeSettings> {
    return this.operations.run(async () => {
      const settings = await this.readStoredSettings();
      const route = this.getActiveRoute(settings);
      return this.runtimeSettings(route, settings, this.decryptCredential(route));
    });
  }

  async getRouteTestSettings(input: SettingsInput): Promise<RuntimeSettings> {
    return this.operations.run(async () => {
      validateLimits(input);
      const settings = await this.readStoredSettings();
      const existing = input.route.id
        ? settings.routes.find((route) => route.id === input.route.id)
        : undefined;
      if (input.route.id && !existing) {
        throw new PublicError("该路由不存在或已删除，请重新创建");
      }
      const route = normalizeRouteInput(input.route, existing?.id || randomUUID());
      const submittedCredential = input.route.clearCredential
        ? ""
        : input.route.credential?.trim();
      let credential = submittedCredential || "";
      if (!credential && existing && hasScopedCredential(existing)) {
        const expected = credentialScopeFor(route);
        const actual = existing.credentialScope!;
        if (
          actual.kind === expected.kind &&
          actual.provider === expected.provider &&
          actual.endpoint === expected.endpoint
        ) {
          credential = this.decryptCredential(existing);
        }
      }
      return this.runtimeSettings(route, input, credential);
    });
  }

  async getUsageLimitSettings(): Promise<UsageLimitSettings> {
    return this.operations.run(async () => {
      const settings = await this.readStoredSettings();
      return {
        maxRequestsPerHour: settings.maxRequestsPerHour,
        dailyTokenBudget: settings.dailyTokenBudget,
        maxOutputTokens: settings.maxOutputTokens,
      };
    });
  }
}
