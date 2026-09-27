import type { RouteTestResult } from "../../shared/types";
import type { RuntimeSettings } from "./settingsStore";
import { buildModelProbeRequest } from "./promptOptimizer";
import { PublicError } from "./publicError";
import { sendTimedHttpRequest } from "./routeDiagnostics";

function routeQuality(totalMs: number): RouteTestResult["quality"] {
  if (totalMs < 350) return "excellent";
  if (totalMs < 900) return "good";
  if (totalMs < 2_000) return "moderate";
  return "high";
}

function throwForProbeStatus(status: number): never {
  if (status === 401 || status === 403) {
    throw new PublicError("路由测试失败：API Key 无效或没有模型权限");
  }
  if (status === 404) {
    throw new PublicError("路由测试失败：未找到接口或所选模型");
  }
  if (status === 429) {
    throw new PublicError("路由测试失败：供应商限流或额度不足");
  }
  if (status >= 500) {
    throw new PublicError("路由测试失败：模型服务暂时不可用");
  }
  throw new PublicError(`路由测试失败（HTTP ${status}）`);
}

export async function testDirectRoute(
  settings: RuntimeSettings,
  signal?: AbortSignal,
): Promise<RouteTestResult> {
  const probe = buildModelProbeRequest(settings);
  const response = await sendTimedHttpRequest({
    url: probe.url,
    method: "POST",
    headers: probe.headers,
    body: probe.body,
    signal,
    timeoutMs: 20_000,
    maxResponseBytes: 65_536,
  });
  if (response.status < 200 || response.status >= 300) {
    throwForProbeStatus(response.status);
  }
  if (!response.body.trim()) {
    throw new PublicError("路由测试失败：模型没有返回任何响应信号");
  }
  return {
    ok: true,
    host: settings.apiHost,
    quality: routeQuality(response.timing.totalMs),
    timing: response.timing,
    message: `已向 ${settings.routeName} 发送最小模型探测并收到响应`,
  };
}
