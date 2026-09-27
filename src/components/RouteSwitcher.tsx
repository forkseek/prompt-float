import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { getProviderDefinition } from "../../shared/providers";
import type { ModelRoute } from "../../shared/types";
import {
  CheckIcon,
  ChevronDownIcon,
  EditIcon,
  LockIcon,
  PlusIcon,
  RouteIcon,
} from "./Icons";

interface RouteSwitcherProps {
  activeRouteId: string;
  disabled?: boolean;
  onEdit: (routeId: string) => void;
  onManage: () => void;
  onSwitch: (routeId: string) => Promise<boolean>;
  routes: ModelRoute[];
  switchingRouteId: string | null;
}

function routeEndpoint(route: ModelRoute): string {
  return route.engine === "prompt-optimizer-mcp"
    ? route.mcpUrl
    : route.baseUrl;
}

function routeHost(route: ModelRoute): string {
  return route.engine === "prompt-optimizer-mcp"
    ? route.mcpHost
    : route.apiHost;
}

function engineLabel(route: ModelRoute): string {
  return route.engine === "prompt-optimizer-mcp" ? "MCP" : "API";
}

export function RouteSwitcher({
  activeRouteId,
  disabled = false,
  onEdit,
  onManage,
  onSwitch,
  routes,
  switchingRouteId,
}: RouteSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeRoute = useMemo(
    () =>
      routes.find((route) => route.id === activeRouteId) || routes[0],
    [activeRouteId, routes],
  );

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSwitchError("");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setSwitchError("");
        triggerRef.current?.focus();
      }
    };

    window.requestAnimationFrame(() => {
      controlRef.current
        ?.querySelector<HTMLElement>('[data-route-active="true"]')
        ?.focus();
    });
    window.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const chooseRoute = async (routeId: string) => {
    if (routeId === activeRouteId) {
      setOpen(false);
      setSwitchError("");
      window.requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }

    setSwitchError("");
    const switched = await onSwitch(routeId);
    if (switched) {
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } else {
      setSwitchError("切换失败，已保持原来的请求链路。请检查该链路配置。");
    }
  };

  const navigateRouteCards = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".route-card-main:not(:disabled)",
      ),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(
      0,
      items.indexOf(document.activeElement as HTMLButtonElement),
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const activeProvider = activeRoute
    ? getProviderDefinition(activeRoute.provider).label
    : "未配置";
  const activePath = activeRoute ? routeEndpoint(activeRoute) : "";
  const activeHost = activeRoute ? routeHost(activeRoute) : "";
  const isSwitching = switchingRouteId !== null;

  return (
    <div className="route-summary route-switcher-shell" ref={controlRef}>
      <div className="route-switcher-label-row">
        <span>API 请求链路</span>
        <span>{routes.length} 条已保存</span>
      </div>

      <button
        aria-controls="route-switcher-popover"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="打开 API 请求链路快速切换"
        className="connection-status route-switcher-trigger"
        data-jelly
        disabled={disabled || isSwitching}
        ref={triggerRef}
        title={
          activeRoute
            ? `当前链路：${activeRoute.name}\n当前 LLM：${activeRoute.model}\n请求路径：${activePath}`
            : "还没有保存 API 请求链路"
        }
        type="button"
        onClick={() => {
          setSwitchError("");
          setOpen((current) => !current);
        }}
      >
        <span
          className={
            isSwitching
              ? "status-dot switching"
              : activeRoute
                ? "status-dot configured"
                : "status-dot"
          }
        />
        <span className="connection-copy" id="active-route-summary">
          <strong>
            {isSwitching
              ? "正在切换请求链路…"
              : activeRoute?.name || "还没有保存链路"}
          </strong>
          <small>
            {activeRoute
              ? `${activeRoute.model} · ${activeProvider} · ${activeHost}`
              : "点击创建第一条 API 或 MCP 链路"}
          </small>
        </span>
        <ChevronDownIcon className={open ? "route-chevron open" : "route-chevron"} />
      </button>

      {open && (
        <section
          aria-label="API 请求链路快速切换"
          className="route-switcher-popover"
          id="route-switcher-popover"
          role="dialog"
          onKeyDown={navigateRouteCards}
        >
          <div className="route-popover-heading">
            <span>
              <RouteIcon />
              <span>
                <strong>请求链路</strong>
                <small>选择后立即用于下一次请求</small>
              </span>
            </span>
            <button
              className="route-manage-button"
              data-jelly
              disabled={isSwitching}
              type="button"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
            >
              <PlusIcon />
              管理
            </button>
          </div>

          {routes.length === 0 ? (
            <div className="route-empty-state">
              <span aria-hidden="true"><RouteIcon /></span>
              <strong>还没有已保存的请求链路</strong>
              <small>添加 API 或 MCP 地址后，就能在这里一键切换。</small>
              <button
                className="primary-button"
                data-jelly
                type="button"
                onClick={() => {
                  setOpen(false);
                  onManage();
                }}
              >
                <PlusIcon />
                新建链路
              </button>
            </div>
          ) : (
            <div className="route-card-list" role="list">
              {routes.map((route) => {
                const isActive = route.id === activeRouteId;
                const routeIsSwitching = switchingRouteId === route.id;
                const provider = getProviderDefinition(route.provider).label;
                return (
                  <article
                    className={`route-card ${isActive ? "is-active" : ""}`}
                    data-route-id={route.id}
                    key={route.id}
                    role="listitem"
                  >
                    <button
                      aria-current={isActive ? "true" : undefined}
                      aria-label={
                        isActive
                          ? `当前链路：${route.name}`
                          : `切换到链路：${route.name}`
                      }
                      className="route-card-main"
                      data-route-active={isActive}
                      data-jelly
                      disabled={disabled || isSwitching}
                      type="button"
                      onClick={() => void chooseRoute(route.id)}
                    >
                      <span className="route-card-title-row">
                        <strong>{route.name}</strong>
                        <span className={isActive ? "route-card-cta active" : "route-card-cta"}>
                          {routeIsSwitching ? (
                            "切换中…"
                          ) : isActive ? (
                            <><CheckIcon />当前使用</>
                          ) : (
                            "切换"
                          )}
                        </span>
                      </span>
                      <span className="route-card-tags">
                        <span>{engineLabel(route)}</span>
                        <span>{provider}</span>
                        {route.hasCredential && (
                          <span className="credential-tag"><LockIcon />凭据已保存</span>
                        )}
                      </span>
                      <span className="route-card-detail">
                        <span><b>模型</b>{route.model}</span>
                        <span title={routeEndpoint(route)}><b>路径</b>{routeHost(route)}</span>
                      </span>
                    </button>
                    <button
                      aria-label={`编辑链路：${route.name}`}
                      className="route-card-edit"
                      data-jelly
                      disabled={disabled || isSwitching}
                      title="编辑这条链路"
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onEdit(route.id);
                      }}
                    >
                      <EditIcon />
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {switchError && (
            <p className="route-switch-error" role="alert">{switchError}</p>
          )}
          <p className="route-privacy-note">
            <LockIcon />
            这里只显示模型、主机和凭据状态，不显示密钥内容。
          </p>
        </section>
      )}
    </div>
  );
}
