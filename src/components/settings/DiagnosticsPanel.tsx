import { useEffect, useState } from "react";
import type { DiagnosticsReport } from "../../../shared/types";

export function DiagnosticsPanel() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setStatus("");
    try {
      setReport(await window.promptFloat.getDiagnostics());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "无法读取诊断信息");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const exportReport = async () => {
    setBusy(true);
    setStatus("");
    try {
      const result = await window.promptFloat.exportDiagnostics();
      setStatus(
        result.saved
          ? `诊断报告已保存：${result.fileName}`
          : "已取消导出诊断报告",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "诊断报告导出失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="diagnostics-fieldset">
      <legend>诊断与兼容性</legend>
      <p className="security-note">
        报告不会包含 API Key、MCP 令牌或提示词正文，可用于排查网络、代理、缩放和窗口问题。
      </p>
      {report && (
        <dl className="diagnostics-grid" aria-label="当前诊断摘要">
          <div>
            <dt>版本</dt>
            <dd>v{report.application.version}</dd>
          </div>
          <div>
            <dt>网络</dt>
            <dd>{report.system.online ? "在线" : "离线"}</dd>
          </div>
          <div>
            <dt>代理</dt>
            <dd>{report.activeRoute?.proxy || "—"}</dd>
          </div>
          <div>
            <dt>显示器</dt>
            <dd>
              {report.displays.length} 个 · {report.displays
                .map((item) => `${item.scaleFactor}×`)
                .join(" / ")}
            </dd>
          </div>
        </dl>
      )}
      <div className="diagnostics-actions">
        <button
          className="secondary-button"
          disabled={busy}
          type="button"
          onClick={() => void refresh()}
        >
          刷新诊断
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          type="button"
          onClick={() => void exportReport()}
        >
          导出诊断报告
        </button>
      </div>
      {status && (
        <p className="diagnostics-status" role="status">
          {status}
        </p>
      )}
    </fieldset>
  );
}
