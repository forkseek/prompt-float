import { clipboard, shell, type BrowserWindow } from "electron";
import { discoverProviderModels } from "../services/modelDiscovery";
import {
  exportDiagnosticsReport,
  getDiagnosticsReport,
  recordDiagnostic,
} from "../services/diagnostics";
import { resolveProviderApiKeyUrl } from "../services/providerLinks";
import {
  activateRoute,
  deleteRoute,
  getPublicSettings,
  getRouteTestSettings,
  getUsageLimitSettings,
  saveSettings,
  saveProviderApiKey,
  setThemePreference,
} from "../services/settingsStore";
import { getBudgetStatus } from "../services/usageLimiter";
import type { SecureHandle } from "./secureHandle";
import {
  apiKeyProviderIdSchema,
  apiKeySetupInputSchema,
  clipboardTextSchema,
  parseIpcPayload,
  routeIdSchema,
  routeInputSchema,
  settingsInputSchema,
  themePreferenceSchema,
} from "./validation";

export function registerSettingsHandlers(
  handle: SecureHandle,
  getWindow: () => BrowserWindow | null,
): void {
  handle("settings:get", () => getPublicSettings());
  handle("settings:theme", (_event, payload) =>
    setThemePreference(parseIpcPayload(themePreferenceSchema, payload)));
  handle("onboarding:save-api-key", (_event, payload) =>
    saveProviderApiKey(parseIpcPayload(apiKeySetupInputSchema, payload)));
  handle("providers:open-api-key-page", async (_event, payload) => {
    const provider = parseIpcPayload(apiKeyProviderIdSchema, payload);
    await shell.openExternal(resolveProviderApiKeyUrl(provider));
  });
  handle("routes:activate", (_event, payload) =>
    activateRoute(parseIpcPayload(routeIdSchema, payload)));
  handle("routes:delete", (_event, payload) =>
    deleteRoute(parseIpcPayload(routeIdSchema, payload)));
  handle("models:discover", async (_event, payload) => {
    const route = parseIpcPayload(routeInputSchema, payload);
    const settings = await getPublicSettings();
    return discoverProviderModels(await getRouteTestSettings({
      route,
      maxRequestsPerHour: settings.maxRequestsPerHour,
      dailyTokenBudget: settings.dailyTokenBudget,
      maxOutputTokens: settings.maxOutputTokens,
    }));
  });
  handle("settings:save", (_event, payload) =>
    saveSettings(parseIpcPayload(settingsInputSchema, payload)));
  handle("usage:get", async () =>
    getBudgetStatus(await getUsageLimitSettings()));
  handle("diagnostics:get", async () =>
    getDiagnosticsReport(getWindow(), await getPublicSettings()));
  handle("diagnostics:export", async () => {
    const report = await getDiagnosticsReport(getWindow(), await getPublicSettings());
    const result = await exportDiagnosticsReport(getWindow(), report);
    recordDiagnostic("info", "diagnostics.exported", { saved: result.saved });
    return result;
  });
  handle("clipboard:write", (_event, payload) => {
    clipboard.writeText(parseIpcPayload(clipboardTextSchema, payload));
  });
  handle("window:minimize", () => getWindow()?.minimize());
  handle("window:close", () => getWindow()?.close());
}
