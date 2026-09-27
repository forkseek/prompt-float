import {
  getProviderDefinition,
  type ApiKeyProviderId,
} from "../../shared/providers";
import { PublicError } from "./publicError";

export function resolveProviderApiKeyUrl(providerId: ApiKeyProviderId): string {
  const provider = getProviderDefinition(providerId);
  if (!provider.apiKeyUrl) {
    throw new PublicError("该供应商没有可用的官方 API Key 配置入口");
  }

  const url = new URL(provider.apiKeyUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new PublicError("供应商 API Key 页面地址不安全");
  }
  return url.href;
}
