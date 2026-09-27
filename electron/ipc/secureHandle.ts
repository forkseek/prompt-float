import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { recordDiagnostic } from "../services/diagnostics";
import { toPublicErrorMessage } from "../services/publicError";
import { assertTrustedIpcSender } from "./validation";

export type SecureHandler = (
  event: IpcMainInvokeEvent,
  payload: unknown,
) => unknown | Promise<unknown>;
export type SecureHandle = (channel: string, handler: SecureHandler) => void;

export function createSecureHandle(
  getWindow: () => BrowserWindow | null,
  expectedRendererUrl: string,
): SecureHandle {
  return (channel, handler) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        assertTrustedIpcSender(event, getWindow(), expectedRendererUrl);
        return await handler(event, payload);
      } catch (error) {
        const message = toPublicErrorMessage(error);
        recordDiagnostic("error", "ipc.request_failed", { channel, message });
        // Do not attach the original cause: it may contain credentials or prompt text.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(message);
      }
    });
  };
}
