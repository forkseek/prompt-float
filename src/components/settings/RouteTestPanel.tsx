import type { RouteTestResult } from "../../../shared/types";
import { SparklesIcon } from "../Icons";

interface RouteTestPanelProps {
  testing: boolean;
  result: RouteTestResult | null;
}

function timingLabel(value: number | undefined): string {
  return value === undefined ? "—" : `${value} ms`;
}

function qualityLabel(quality: RouteTestResult["quality"]): string {
  return {
    excellent: "优秀",
    good: "良好",
    moderate: "一般",
    high: "偏高",
  }[quality];
}

export function RouteTestPanel({ testing, result }: RouteTestPanelProps) {
  return (
    <fieldset className="route-test-fieldset">
      <legend>线路测试</legend>
      <p className="security-note">
        测试会发送一个极小的真实请求，并计入一次请求和少量 token 预算。
      </p>
      {testing && (
        <div className="route-test-progress" role="status" aria-live="polite">
          <span className="generation-mark" aria-hidden="true">
            <SparklesIcon />
          </span>
          <span>
            <strong>正在验证模型连接</strong>
            <small>正在连接服务、发送请求并等待首个响应…</small>
          </span>
        </div>
      )}
      {result?.ok && (
        <div className="route-test-result" aria-live="polite">
          <div className="route-test-heading">
            <strong>{result.message}</strong>
            <span className={`quality-badge ${result.quality}`}>
              {qualityLabel(result.quality)}
            </span>
          </div>
          <div className="route-test-primary-metrics">
            <span>
              首响应 <b>{timingLabel(result.timing.firstResponseMs)}</b>
            </span>
            <span className="total-timing">
              总回路 <b>{timingLabel(result.timing.totalMs)}</b>
            </span>
          </div>
          <details className="timing-details">
            <summary>查看网络技术详情</summary>
            <div className="timing-grid">
              <span>DNS <b>{timingLabel(result.timing.dnsMs)}</b></span>
              <span>TCP <b>{timingLabel(result.timing.tcpMs)}</b></span>
              <span>TLS <b>{timingLabel(result.timing.tlsMs)}</b></span>
              <span>发送完成 <b>{timingLabel(result.timing.sendMs)}</b></span>
              <span>首字节 <b>{timingLabel(result.timing.firstByteMs)}</b></span>
              {result.timing.mcpHandshakeMs !== undefined && (
                <span>
                  MCP 握手 <b>{timingLabel(result.timing.mcpHandshakeMs)}</b>
                </span>
              )}
              {result.timing.toolDiscoveryMs !== undefined && (
                <span>
                  工具发现 <b>{timingLabel(result.timing.toolDiscoveryMs)}</b>
                </span>
              )}
              {result.timing.modelProbeMs !== undefined && (
                <span>
                  模型探测 <b>{timingLabel(result.timing.modelProbeMs)}</b>
                </span>
              )}
            </div>
          </details>
        </div>
      )}
    </fieldset>
  );
}
