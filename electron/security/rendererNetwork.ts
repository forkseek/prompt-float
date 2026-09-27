import type { Session } from "electron";
import { PACKAGED_RENDERER_URL } from "../../shared/securityPolicy";

export const BLOCKED_RENDERER_NETWORK_PATTERNS = Object.freeze([
  "http://*/*",
  "https://*/*",
  "ws://*/*",
  "wss://*/*",
]);

export function isRemoteRendererRequest(value: string): boolean {
  try {
    return new Set(["http:", "https:", "ws:", "wss:"]).has(
      new URL(value).protocol,
    );
  } catch {
    return false;
  }
}

export function hardenProductionRendererSession(
  rendererSession: Session,
  trustedRendererUrl: string,
): void {
  if (trustedRendererUrl !== PACKAGED_RENDERER_URL) {
    throw new Error("Unexpected production renderer URL");
  }

  rendererSession.webRequest.onBeforeRequest(
    { urls: [...BLOCKED_RENDERER_NETWORK_PATTERNS] },
    (details, callback) => {
      callback({ cancel: isRemoteRendererRequest(details.url) });
    },
  );
}
