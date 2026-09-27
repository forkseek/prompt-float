export interface EndpointInfo {
  normalizedUrl: string;
  hostname: string;
  displayHost: string;
  isLoopback: boolean;
  requiresConfirmation: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function inspectEndpoint(value: string): EndpointInfo {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new PublicError("服务地址不能为空");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PublicError("服务地址格式不正确");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PublicError("服务地址必须使用 HTTP 或 HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new PublicError("服务地址不能包含账号或密码");
  }
  if (parsed.search || parsed.hash) {
    throw new PublicError("服务地址不能包含查询参数或片段");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(hostname);
  if (parsed.protocol === "http:" && !isLoopback) {
    throw new PublicError("远程 API 必须使用 HTTPS；HTTP 仅允许本机地址");
  }

  return {
    normalizedUrl: trimmed,
    hostname,
    displayHost: parsed.host,
    isLoopback,
    requiresConfirmation: !isLoopback,
  };
}

export function assertEndpointConfirmed(
  info: EndpointInfo,
  confirmedHost?: string,
): void {
  if (
    info.requiresConfirmation &&
    confirmedHost?.trim().toLowerCase() !== info.hostname
  ) {
    throw new PublicError(`请先确认数据发送域名：${info.hostname}`);
  }
}

export function buildModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return `${normalized.slice(0, -"/chat/completions".length)}/models`;
  }
  return `${normalized}/models`;
}
import { PublicError } from "./publicError";
