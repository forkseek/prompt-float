import { describe, expect, it } from "vitest";
import {
  normalizeUpdateUrl,
  pinUpdateSignatureVerifier,
  resolveTrustedUpdateConfig,
} from "./updateTrust";

const trustedPackage = {
  releaseTrust: {
    updateUrl: "https://updates.example.com/prompt-float/",
    publisherName: "CN=Example Publisher, O=Example Org, C=US",
  },
};
const trustedUpdater = {
  provider: "generic",
  url: "https://updates.example.com/prompt-float/",
  publisherName: ["CN=Example Publisher, O=Example Org, C=US"],
};

describe("signed update trust", () => {
  it("pins installer signature verification to the packaged publisher", async () => {
    const verifiedNames: string[][] = [];
    const verifier = pinUpdateSignatureVerifier(
      trustedPackage.releaseTrust.publisherName,
      async (names) => {
        verifiedNames.push(names);
        return null;
      },
    );
    await expect(verifier(["CN=Attacker"], "update.exe")).resolves.toBeNull();
    expect(verifiedNames).toEqual([[trustedPackage.releaseTrust.publisherName]]);
  });

  it("accepts only matching embedded and updater configuration", () => {
    expect(resolveTrustedUpdateConfig(trustedPackage, trustedUpdater)).toEqual({
      updateUrl: trustedPackage.releaseTrust.updateUrl,
      publisherName: trustedPackage.releaseTrust.publisherName,
    });
  });

  it("rejects a missing trust root, a changed feed, and a changed signer", () => {
    expect(resolveTrustedUpdateConfig({}, trustedUpdater)).toBeNull();
    expect(resolveTrustedUpdateConfig(trustedPackage, {
      ...trustedUpdater,
      url: "https://attacker.example.com/",
    })).toBeNull();
    expect(resolveTrustedUpdateConfig(trustedPackage, {
      ...trustedUpdater,
      publisherName: ["CN=Other"],
    })).toBeNull();
    expect(resolveTrustedUpdateConfig(trustedPackage, {
      ...trustedUpdater,
      publisherName: undefined,
    })).toBeNull();
  });

  it("rejects local, credentialed, and non-HTTPS feeds", () => {
    for (const value of [
      "http://updates.example.com/",
      "https://127.0.0.1/",
      "https://user:pass@updates.example.com/",
      "https://updates.example.com/?token=x",
      "https://updates.example.com/#fragment",
    ]) {
      expect(normalizeUpdateUrl(value)).toBeNull();
    }
  });
});
