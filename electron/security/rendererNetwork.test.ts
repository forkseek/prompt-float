import { describe, expect, it, vi } from "vitest";
import {
  DEVELOPMENT_RENDERER_CSP,
  PACKAGED_RENDERER_URL,
  PRODUCTION_RENDERER_CSP,
  PRODUCTION_RENDERER_CSP_HEADER,
} from "../../shared/securityPolicy";
import {
  BLOCKED_RENDERER_NETWORK_PATTERNS,
  hardenProductionRendererSession,
  isRemoteRendererRequest,
} from "./rendererNetwork";

describe("renderer network security", () => {
  it.each([
    "http://127.0.0.1:3000/mcp",
    "https://api.openai.com/v1/models",
    "ws://127.0.0.1:5173/",
    "wss://attacker.invalid/socket",
  ])("classifies remote renderer traffic: %s", (value) => {
    expect(isRemoteRendererRequest(value)).toBe(true);
  });

  it.each([
    "file:///C:/Program%20Files/Prompt%20Float/index.html",
    PACKAGED_RENDERER_URL,
    "data:text/plain,hello",
    "about:blank",
    "not-a-url",
  ])("does not classify local or invalid URLs as remote: %s", (value) => {
    expect(isRemoteRendererRequest(value)).toBe(false);
  });

  it("uses a production CSP with no renderer network or inline-style access", () => {
    expect(PRODUCTION_RENDERER_CSP).toContain("default-src 'none'");
    expect(PRODUCTION_RENDERER_CSP).toContain("connect-src 'none'");
    expect(PRODUCTION_RENDERER_CSP).toContain("style-src 'self'");
    expect(PRODUCTION_RENDERER_CSP).not.toContain("'unsafe-inline'");
    expect(PRODUCTION_RENDERER_CSP).not.toContain("127.0.0.1");
    expect(PRODUCTION_RENDERER_CSP_HEADER).toContain(
      "frame-ancestors 'none'",
    );
    expect(DEVELOPMENT_RENDERER_CSP).toContain(
      "ws://127.0.0.1:5173",
    );
  });

  it("registers production renderer network cancellation", () => {
    let beforeRequest:
      | ((details: { url: string }, callback: (result: object) => void) => void)
      | undefined;
    const onBeforeRequest = vi.fn(
      (
        _filter: object,
        handler: typeof beforeRequest,
      ) => {
        beforeRequest = handler;
      },
    );
    const rendererSession = {
      webRequest: { onBeforeRequest },
    };

    hardenProductionRendererSession(
      rendererSession as never,
      PACKAGED_RENDERER_URL,
    );

    expect(onBeforeRequest).toHaveBeenCalledWith(
      { urls: [...BLOCKED_RENDERER_NETWORK_PATTERNS] },
      expect.any(Function),
    );

    let cancellation: object | undefined;
    beforeRequest?.(
      { url: "https://attacker.invalid/payload.js" },
      (result) => {
        cancellation = result;
      },
    );
    expect(cancellation).toEqual({ cancel: true });
  });

  it("rejects an unexpected production renderer URL", () => {
    expect(() =>
      hardenProductionRendererSession(
        { webRequest: {} } as never,
        "https://attacker.invalid/",
      ),
    ).toThrow(/Unexpected production renderer URL/);
  });
});
