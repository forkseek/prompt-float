import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiKeySetupInput,
  OptimizationEvent,
  OptimizeRequest,
  PromptFloatApi,
  RouteInput,
  SettingsInput,
  ThemePreference,
} from "../shared/types";
import type { ApiKeyProviderId } from "../shared/providers";

const api: PromptFloatApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setTheme: (theme: ThemePreference) =>
    ipcRenderer.invoke("settings:theme", theme),
  saveProviderApiKey: (input: ApiKeySetupInput) =>
    ipcRenderer.invoke("onboarding:save-api-key", input),
  openProviderApiKeyPage: (provider: ApiKeyProviderId) =>
    ipcRenderer.invoke("providers:open-api-key-page", provider),
  saveSettings: (settings: SettingsInput) =>
    ipcRenderer.invoke("settings:save", settings),
  activateRoute: (routeId: string) =>
    ipcRenderer.invoke("routes:activate", routeId),
  deleteRoute: (routeId: string) => ipcRenderer.invoke("routes:delete", routeId),
  discoverModels: (route: RouteInput) =>
    ipcRenderer.invoke("models:discover", route),
  testRoute: (settings: SettingsInput) =>
    ipcRenderer.invoke("routes:test", settings),
  getBudgetStatus: () => ipcRenderer.invoke("usage:get"),
  listHistory: () => ipcRenderer.invoke("history:list"),
  getDiagnostics: () =>
    ipcRenderer.invoke("diagnostics:get"),
  exportDiagnostics: () =>
    ipcRenderer.invoke("diagnostics:export"),
  optimize: (request: OptimizeRequest) =>
    ipcRenderer.invoke("optimizer:optimize", request),
  cancelOptimization: (requestId: string) =>
    ipcRenderer.send("optimizer:cancel", requestId),
  onOptimizationEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: OptimizationEvent) =>
      callback(data);
    ipcRenderer.on("optimizer:event", listener);
    return () => ipcRenderer.removeListener("optimizer:event", listener);
  },
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  writeClipboard: (text: string) => ipcRenderer.invoke("clipboard:write", text),
};

contextBridge.exposeInMainWorld("promptFloat", api);
