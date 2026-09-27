import type { ModelRoute, OptimizationEngine, PublicSettings } from "../../../shared/types";

interface RoutePickerSectionProps {
  settings: PublicSettings;
  selectedRouteId: string;
  disabled: boolean;
  pendingRoute?: ModelRoute;
  bindingPrefix: string;
  model: string;
  engine: OptimizationEngine;
  requestPath: string;
  onSelectRoute: (routeId: string) => void;
  onNewRoute: () => void;
  onDismissPending: () => void;
  onConfirmPending: (routeId: string) => void;
}

export function RoutePickerSection({
  settings,
  selectedRouteId,
  disabled,
  pendingRoute,
  bindingPrefix,
  model,
  engine,
  requestPath,
  onSelectRoute,
  onNewRoute,
  onDismissPending,
  onConfirmPending,
}: RoutePickerSectionProps) {
  return (
    <section className="settings-section route-manager-section" aria-labelledby="route-manager-title">
      <div className="section-heading">
        <span className="section-index">01</span>
        <span>
          <strong id="route-manager-title">选择模型线路</strong>
          <small>切换线路时，模型与请求地址会一起切换</small>
        </span>
      </div>
      <div className="route-picker">
        <label className="field-label">
          已保存路由（选择即启用）
          <select
            aria-label="已保存路由"
            value={selectedRouteId}
            disabled={disabled}
            onChange={(event) => onSelectRoute(event.target.value)}
          >
            {settings.routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.id === settings.activeRouteId ? "● " : ""}
                {route.name} · {route.model}
              </option>
            ))}
            {selectedRouteId === "new" && (
              <option value="new">新模型路由（未保存）</option>
            )}
          </select>
        </label>
        <button
          className="secondary-button"
          data-jelly
          type="button"
          disabled={disabled}
          onClick={onNewRoute}
        >
          新建路由
        </button>
      </div>
      {pendingRoute && (
        <div className="route-switch-warning" role="status">
          <span>当前编辑尚未保存；切换到“{pendingRoute.name}”会丢弃这些编辑。</span>
          <div>
            <button className="secondary-button" data-jelly type="button" onClick={onDismissPending}>
              留在当前路由
            </button>
            <button
              className="primary-button"
              data-jelly
              type="button"
              onClick={() => onConfirmPending(pendingRoute.id)}
            >
              丢弃并切换
            </button>
          </div>
        </div>
      )}
      <div className="route-binding" aria-label="当前路由映射" aria-live="polite">
        <span>
          <small>{bindingPrefix} LLM</small>
          <strong>{model || "未选择模型"}</strong>
        </span>
        <span>
          <small>{bindingPrefix}{engine === "direct" ? " API 请求路径" : " MCP 请求路径"}</small>
          <code>{requestPath || "未填写"}</code>
        </span>
      </div>
    </section>
  );
}
