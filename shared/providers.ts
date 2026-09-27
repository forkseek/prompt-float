export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "zhipu",
  "siliconflow",
  "openai-compatible",
] as const;

export const API_KEY_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "zhipu",
  "siliconflow",
] as const;

export type ModelProviderId = (typeof PROVIDER_IDS)[number];
export type ApiKeyProviderId = (typeof API_KEY_PROVIDER_IDS)[number];
export type ModelProviderProtocol =
  | "openai-compatible"
  | "anthropic-messages"
  | "gemini-generate-content";

export interface ProviderDefinition {
  id: ModelProviderId;
  label: string;
  protocol: ModelProviderProtocol;
  defaultBaseUrl: string;
  fallbackModels: readonly string[];
  credentialLabel: string;
  apiKeyUrl?: string;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    fallbackModels: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
    credentialLabel: "OpenAI API Key",
    apiKeyUrl: "https://platform.openai.com/settings/organization/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    protocol: "anthropic-messages",
    defaultBaseUrl: "https://api.anthropic.com",
    fallbackModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
    credentialLabel: "Anthropic API Key",
    apiKeyUrl: "https://platform.claude.com/settings/keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "gemini-generate-content",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    fallbackModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
    credentialLabel: "Google AI API Key",
    apiKeyUrl: "https://aistudio.google.com/api-keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    fallbackModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
    credentialLabel: "DeepSeek API Key",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "zhipu",
    label: "智谱 AI",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    fallbackModels: ["glm-4.5", "glm-4.5-air", "glm-4-flash"],
    credentialLabel: "智谱 API Key",
    apiKeyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    fallbackModels: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-8B"],
    credentialLabel: "硅基流动 API Key",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "openai-compatible",
    label: "自定义 OpenAI 兼容接口",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://api.example.com/v1",
    fallbackModels: [],
    credentialLabel: "API Key",
  },
];

export const API_KEY_PROVIDERS = PROVIDERS.filter(
  (provider): provider is ProviderDefinition & {
    id: ApiKeyProviderId;
    apiKeyUrl: string;
  } =>
    API_KEY_PROVIDER_IDS.includes(provider.id as ApiKeyProviderId) &&
    Boolean(provider.apiKeyUrl),
);

export function getProviderDefinition(id: ModelProviderId): ProviderDefinition {
  const provider = PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function inferProviderFromBaseUrl(value: string): ModelProviderId {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname === "api.openai.com") return "openai";
    if (hostname === "api.anthropic.com") return "anthropic";
    if (hostname === "generativelanguage.googleapis.com") return "gemini";
    if (hostname === "api.deepseek.com") return "deepseek";
    if (hostname === "open.bigmodel.cn") return "zhipu";
    if (hostname === "api.siliconflow.cn") return "siliconflow";
  } catch {
    // Validation happens in the main process. Unknown input is custom here.
  }
  return "openai-compatible";
}
