import type { BrowserWindow } from "electron";
import { registerHistoryHandlers } from "./historyHandlers";
import { cancelAllRequests, registerOptimizationHandlers } from "./optimizationHandlers";
import { createSecureHandle } from "./secureHandle";
import { registerSettingsHandlers } from "./settingsHandlers";

export { cancelAllRequests };

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  expectedRendererUrl: string,
): void {
  const handle = createSecureHandle(getWindow, expectedRendererUrl);
  registerSettingsHandlers(handle, getWindow);
  registerHistoryHandlers(handle);
  registerOptimizationHandlers(handle, getWindow, expectedRendererUrl);
}
