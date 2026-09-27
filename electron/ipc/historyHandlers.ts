import { listHistory } from "../services/historyStore";
import type { SecureHandle } from "./secureHandle";

export function registerHistoryHandlers(handle: SecureHandle): void {
  handle("history:list", () => listHistory());
}
