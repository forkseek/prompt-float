import { describe, expect, it } from "vitest";
import {
  API_KEY_PROVIDERS,
  type ApiKeyProviderId,
} from "../../shared/providers";
import { resolveProviderApiKeyUrl } from "./providerLinks";

describe("provider API key links", () => {
  it("resolves every configured provider to a fixed HTTPS page", () => {
    for (const provider of API_KEY_PROVIDERS) {
      const url = new URL(resolveProviderApiKeyUrl(provider.id));
      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(url.href).toBe(new URL(provider.apiKeyUrl).href);
    }
  });

  it("rejects providers without a verified key page", () => {
    expect(() =>
      resolveProviderApiKeyUrl("openai-compatible" as ApiKeyProviderId),
    ).toThrow("没有可用的官方 API Key 配置入口");
  });
});
