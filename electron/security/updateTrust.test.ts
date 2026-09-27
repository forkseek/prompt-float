import { describe, expect, it } from "vitest";
import releaseTarget from "../../shared/releaseTarget.json";
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
const githubPackage = {
  releaseTrust: {
    ...releaseTarget,
    publisherName: trustedPackage.releaseTrust.publisherName,
  },
};
const githubUpdater = {
  ...releaseTarget,
  publisherName: [trustedPackage.releaseTrust.publisherName],
  updaterCacheDirName: "prompt-float-updater",
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
      provider: "generic",
      updateUrl: trustedPackage.releaseTrust.updateUrl,
      publisherName: trustedPackage.releaseTrust.publisherName,
    });
  });

  it("accepts only the pinned public GitHub release repository", () => {
    expect(resolveTrustedUpdateConfig(githubPackage, githubUpdater)).toEqual({
      ...releaseTarget,
      publisherName: githubPackage.releaseTrust.publisherName,
    });
  });

  it("rejects a replaced GitHub repository, host, protocol, or signer", () => {
    expect(resolveTrustedUpdateConfig({}, githubUpdater)).toBeNull();
    for (const [key, value] of [
      ["owner", "attacker"],
      ["repo", "attacker-repo"],
      ["host", "attacker.example"],
      ["protocol", "http"],
    ] as const) {
      expect(resolveTrustedUpdateConfig(githubPackage, {
        ...githubUpdater, [key]: value,
      })).toBeNull();
      expect(resolveTrustedUpdateConfig({
        releaseTrust: { ...githubPackage.releaseTrust, [key]: value },
      }, githubUpdater)).toBeNull();
    }
    expect(resolveTrustedUpdateConfig(githubPackage, {
      ...githubUpdater, publisherName: ["CN=Attacker"],
    })).toBeNull();
  });

  it("rejects private mode, tokens, headers, and channel overrides", () => {
    for (const extra of [
      { private: true },
      { token: "attacker-token" },
      { requestHeaders: { authorization: "attacker-token" } },
      { channel: "attacker" },
    ]) {
      expect(resolveTrustedUpdateConfig(githubPackage, {
        ...githubUpdater, ...extra,
      })).toBeNull();
    }
  });

  it("rejects cache paths that could escape the updater cache directory", () => {
    for (const cacheDirName of ["../outside", "..\\outside", "a..b", "", 12]) {
      expect(resolveTrustedUpdateConfig(githubPackage, {
        ...githubUpdater, updaterCacheDirName: cacheDirName,
      })).toBeNull();
    }
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
