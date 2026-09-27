import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PACKAGED_RENDERER_URL } from "../../shared/securityPolicy";
import { resolveRendererTarget } from "./rendererTrust";

const rendererFilePath = path.resolve("dist", "index.html");

describe("renderer trust policy", () => {
  it.each([
    "https://attacker.invalid/renderer",
    "http://127.0.0.1:5173/",
    "file:///C:/malicious/renderer.html",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "http://127.0.0.1:5173@attacker.invalid/",
    "  https://attacker.invalid/with-whitespace  ",
  ])(
    "always ignores a packaged VITE_DEV_SERVER_URL value: %s",
    (developmentServerUrl) => {
      const target = resolveRendererTarget({
        packaged: true,
        rendererFilePath,
        developmentServerUrl,
      });

      expect(target).toEqual({
        kind: "packaged-url",
        url: PACKAGED_RENDERER_URL,
        trustedUrl: PACKAGED_RENDERER_URL,
      });
      expect(Object.isFrozen(target)).toBe(true);
    },
  );

  it("uses the local file when development has no configured server", () => {
    expect(
      resolveRendererTarget({ packaged: false, rendererFilePath }),
    ).toMatchObject({
      kind: "file",
      trustedUrl: pathToFileURL(rendererFilePath).href,
    });
  });

  it("allows only the exact fixed loopback development server", () => {
    const target = resolveRendererTarget({
      packaged: false,
      rendererFilePath,
      developmentServerUrl: "http://127.0.0.1:5173",
    });

    expect(target).toEqual({
      kind: "development-url",
      url: "http://127.0.0.1:5173/",
      trustedUrl: "http://127.0.0.1:5173/",
    });
    expect(Object.isFrozen(target)).toBe(true);
  });

  it.each([
    "http://localhost:5173/",
    "http://127.0.0.1:4173/",
    "https://127.0.0.1:5173/",
    "http://192.168.1.10:5173/",
    "http://example.com:5173/",
    "http://user:password@127.0.0.1:5173/",
    "http://127.0.0.1:5173@attacker.invalid/",
    "http://127.0.0.1:5173/subpath",
    "http://127.0.0.1:5173/?source=external",
    "http://127.0.0.1:5173/#renderer",
    "file:///C:/malicious/renderer.html",
    "data:text/html,malicious",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects an untrusted development renderer: %s", (value) => {
    expect(() =>
      resolveRendererTarget({
        packaged: false,
        rendererFilePath,
        developmentServerUrl: value,
      }),
    ).toThrow(/VITE_DEV_SERVER_URL/);
  });
});
