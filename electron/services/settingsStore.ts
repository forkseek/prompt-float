import { app, safeStorage } from "electron";
import path from "node:path";
import type {
  ApiKeySetupInput,
  PublicSettings,
  SettingsInput,
  ThemePreference,
} from "../../shared/types";
import { recordDiagnostic } from "./diagnostics";
import {
  SettingsRepository,
  type RuntimeSettings,
  type UsageLimitSettings,
} from "./settingsRepository";

export type { RuntimeSettings, UsageLimitSettings } from "./settingsRepository";

let repository: SettingsRepository | undefined;
let repositoryPath = "";

function getRepository(): SettingsRepository {
  const nextPath = path.join(app.getPath("userData"), "settings.json");
  if (!repository || repositoryPath !== nextPath) {
    repositoryPath = nextPath;
    repository = new SettingsRepository(nextPath, safeStorage, (message) =>
      recordDiagnostic("warning", "settings.repository_warning", {
        message,
      }),
    );
  }
  return repository;
}

export function getPublicSettings(): Promise<PublicSettings> {
  return getRepository().getPublicSettings();
}

export function saveSettings(input: SettingsInput): Promise<PublicSettings> {
  return getRepository().saveSettings(input);
}

export function saveProviderApiKey(
  input: ApiKeySetupInput,
): Promise<PublicSettings> {
  return getRepository().saveProviderApiKey(input);
}

export function setThemePreference(
  theme: ThemePreference,
): Promise<PublicSettings> {
  return getRepository().setThemePreference(theme);
}

export function activateRoute(routeId: string): Promise<PublicSettings> {
  return getRepository().activateRoute(routeId);
}

export function deleteRoute(routeId: string): Promise<PublicSettings> {
  return getRepository().deleteRoute(routeId);
}

export function getRuntimeSettings(): Promise<RuntimeSettings> {
  return getRepository().getRuntimeSettings();
}

export function getRouteTestSettings(
  input: SettingsInput,
): Promise<RuntimeSettings> {
  return getRepository().getRouteTestSettings(input);
}

export function getUsageLimitSettings(): Promise<UsageLimitSettings> {
  return getRepository().getUsageLimitSettings();
}
