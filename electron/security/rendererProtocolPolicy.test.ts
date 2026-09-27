import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGED_RENDERER_URL } from "../../shared/securityPolicy";
import {
  isPackagedRendererDocument,
  isTrustedPackagedRendererInitiator,
  resolvePackagedRendererFile,
} from "./rendererProtocolPolicy";

const rendererDirectory = path.resolve("dist");

describe("packaged renderer protocol policy", () => {
  it("maps only the packaged app host into the renderer directory", () => {
    expect(
      resolvePackagedRendererFile(rendererDirectory, PACKAGED_RENDERER_URL),
    ).toBe(path.join(rendererDirectory, "index.html"));
    expect(
      resolvePackagedRendererFile(
        rendererDirectory,
        "prompt-float://app/assets/index.js",
      ),
    ).toBe(path.join(rendererDirectory, "assets", "index.js"));
  });

  it.each([
    "prompt-float://attacker/index.html",
    "prompt-float://user:password@app/index.html",
    "prompt-float://app/index.html?remote=1",
    "prompt-float://app/index.html#fragment",
    "prompt-float://app/%2e%2e%5csecret.txt",
    "https://attacker.invalid/index.html",
    "not-a-url",
  ])("rejects an untrusted protocol request: %s", (value) => {
    expect(resolvePackagedRendererFile(rendererDirectory, value)).toBeNull();
  });

  it("recognizes only the exact packaged document URL", () => {
    expect(isPackagedRendererDocument(PACKAGED_RENDERER_URL)).toBe(true);
    expect(
      isPackagedRendererDocument("prompt-float://app/assets/index.js"),
    ).toBe(false);
  });

  it("allows only browser navigation or the packaged renderer origin", () => {
    expect(isTrustedPackagedRendererInitiator(undefined)).toBe(true);
    expect(
      isTrustedPackagedRendererInitiator("prompt-float://app"),
    ).toBe(true);
    expect(
      isTrustedPackagedRendererInitiator("https://attacker.invalid"),
    ).toBe(false);
    expect(isTrustedPackagedRendererInitiator("null")).toBe(false);
  });
});
