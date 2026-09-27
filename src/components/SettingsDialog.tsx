import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProviderDefinition,
  type ModelProviderId,
} from "../../shared/providers";
import type {
  ModelDiscoveryResult,
  ModelRoute,
  PublicSettings,
  RouteInput,
  RouteTestResult,
  SettingsInput,
} from "../../shared/types";
import { useModalFocus } from "../hooks/useModalFocus";
import { AlertIcon, CloseIcon } from "./Icons";
import { ConnectionSettingsSection } from "./settings/ConnectionSettingsSection";
import { DiagnosticsPanel } from "./settings/DiagnosticsPanel";
import { RouteTestPanel } from "./settings/RouteTestPanel";
import { RoutePickerSection } from "./settings/RoutePickerSection";
import { UsageLimitsPanel } from "./settings/UsageLimitsPanel";
import {
  mergeModels,
  modelsFor,
  newRouteDraft,
  previewEndpoint,
  routeToDraft,
  sameRouteDraft,
  sameStoredCredential,
} from "./routeDraft";

interface SettingsDialogProps {
  initialRouteId?: string;
  settings: PublicSettings;
  onClose: () => void;
  onOpenApiKeySetup: () => void;
  onSaved: (settings: PublicSettings) => void;
}

export function SettingsDialog({
  initialRouteId,
  settings,
  onClose,
  onOpenApiKeySetup,
  onSaved,
}: SettingsDialogProps) {
  const initialRoute =
    settings.routes.find((route) => route.id === initialRouteId) ||
    settings.routes.find((route) => route.id === settings.activeRouteId) ||
    settings.routes[0];
  const initialDraft = initialRoute ? routeToDraft(initialRoute) : newRouteDraft();
  const [selectedRouteId, setSelectedRouteId] = useState(initialRoute?.id || "new");
  const [draft, setDraft] = useState<RouteInput>(initialDraft);
  const [credential, setCredential] = useState("");
  const [clearCredential, setClearCredential] = useState(false);
  const [availableModels, setAvailableModels] = useState(() =>
    modelsFor(initialDraft.provider, initialDraft.model),
  );
  const [modelStatus, setModelStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [routeSwitching, setRouteSwitching] = useState(false);
  const [pendingRouteId, setPendingRouteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<RouteTestResult | null>(null);
  const [maxRequestsPerHour, setMaxRequestsPerHour] = useState(
    settings.maxRequestsPerHour,
  );
  const [dailyTokenBudget, setDailyTokenBudget] = useState(
    settings.dailyTokenBudget,
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    settings.maxOutputTokens,
  );
  const modelRequestVersion = useRef(0);
  const modelCatalogByRouteId = useRef(new Map<string, string[]>());
  const initialModelLoadStarted = useRef(false);
  const dialogRef = useModalFocus<HTMLElement>(onClose);

  const selectedRoute = useMemo(
    () => settings.routes.find((route) => route.id === selectedRouteId),
    [selectedRouteId, settings.routes],
  );
  const apiEndpoint = useMemo(() => previewEndpoint(draft.baseUrl), [draft.baseUrl]);
  const mcpEndpoint = useMemo(() => previewEndpoint(draft.mcpUrl), [draft.mcpUrl]);
  const activeEndpoint = draft.engine === "direct" ? apiEndpoint : mcpEndpoint;
  const activeConfirmedHost =
    draft.engine === "direct"
      ? draft.confirmedApiHost
      : draft.confirmedMcpHost;
  const domainConfirmed = Boolean(
    activeEndpoint &&
      (activeEndpoint.isLoopback ||
        activeConfirmedHost === activeEndpoint.hostname),
  );
  const storedCredentialUsable = sameStoredCredential(selectedRoute, draft);
  const credentialLabel =
    draft.engine === "direct" ? "API Key" : "MCP 访问令牌";
  const hasEnteredCredential = Boolean(credential.trim());
  const credentialStatus = clearCredential
    ? {
        state: "warning",
        message: `保存后将清除该路由的 ${credentialLabel}。`,
      }
    : hasEnteredCredential
      ? {
          state: "pending",
          message: `已输入新的 ${credentialLabel}；点击“保存并启用”后将由系统加密保存。`,
        }
      : storedCredentialUsable
        ? {
            state: "saved",
            message: `${credentialLabel} 已安全保存。为防止泄露，重新打开设置时密码框始终留空。`,
          }
        : selectedRoute?.credentialNeedsReentry
          ? {
              state: "warning",
              message: `已保存的 ${credentialLabel} 无法解密。请在此输入新凭据，点击“保存并启用”，然后再测试路由。`,
            }
        : selectedRoute?.hasCredential
          ? {
              state: "warning",
              message:
                "供应商、运行模式或请求地址已改变；原路由凭据不会转移，请重新输入。",
            }
          : {
              state: draft.engine === "direct" ? "warning" : "neutral",
              message:
                draft.engine === "direct"
                  ? "尚未保存 API Key；直连路由必须填写后才能保存并启用。"
                  : "尚未保存 MCP 访问令牌；不需要鉴权的 MCP 服务可以留空。",
            };
  const modelOptions = useMemo(
    () => mergeModels(draft.model, availableModels),
    [availableModels, draft.model],
  );
  const requestPath = draft.engine === "direct" ? draft.baseUrl : draft.mcpUrl;
  const pendingRoute = useMemo(
    () => settings.routes.find((route) => route.id === pendingRouteId),
    [pendingRouteId, settings.routes],
  );
  const hasUnsavedChanges = Boolean(
    !selectedRoute ||
      !sameRouteDraft(selectedRoute, draft) ||
      credential.trim() ||
      clearCredential ||
      maxRequestsPerHour !== settings.maxRequestsPerHour ||
      dailyTokenBudget !== settings.dailyTokenBudget ||
      maxOutputTokens !== settings.maxOutputTokens,
  );
  const routeDraftMatchesActiveRoute = Boolean(
    selectedRoute &&
      selectedRoute.id === settings.activeRouteId &&
      sameRouteDraft(selectedRoute, draft),
  );
  const routeBindingPrefix = routeDraftMatchesActiveRoute
    ? "当前生效"
    : "待保存";

  const invalidateModelDiscovery = () => {
    modelRequestVersion.current += 1;
    setDiscovering(false);
  };

  const updateDraft = (update: Partial<RouteInput>) => {
    invalidateModelDiscovery();
    setDraft((current) => ({ ...current, ...update }));
    setTestResult(null);
    setError("");
  };

  const buildRouteInput = (): RouteInput => ({
    ...draft,
    credential: credential.trim() || undefined,
    clearCredential: clearCredential || undefined,
  });

  const buildSettingsInput = (): SettingsInput => ({
    route: buildRouteInput(),
    maxRequestsPerHour,
    dailyTokenBudget,
    maxOutputTokens,
  });

  const loadSavedRouteModels = async (route: ModelRoute) => {
    const requestVersion = ++modelRequestVersion.current;
    const fallbackModels = modelsFor(route.provider, route.model);
    const cachedModels = modelCatalogByRouteId.current.get(route.id);

    if (cachedModels) {
      setAvailableModels(mergeModels(route.model, cachedModels));
      setModelStatus(
        `已恢复 ${getProviderDefinition(route.provider).label} 的模型列表，可手动刷新。`,
      );
      return;
    }

    setAvailableModels(fallbackModels);
    if (route.engine === "prompt-optimizer-mcp") {
      setModelStatus(
        "MCP 服务端决定实际模型；已预选该路由保存的模型，并显示供应商建议列表。",
      );
      return;
    }
    if (!route.hasCredential) {
      setModelStatus(
        "该路由尚未保存可用 API Key；当前显示建议模型。填写 Key 后可获取该供应商的完整模型列表。",
      );
      return;
    }

    setDiscovering(true);
    setModelStatus(`正在从 ${getProviderDefinition(route.provider).label} 获取模型列表…`);
    try {
      const result: ModelDiscoveryResult = await window.promptFloat.discoverModels(
        routeToDraft(route),
      );
      if (requestVersion !== modelRequestVersion.current) return;
      const models = mergeModels(route.model, result.models);
      modelCatalogByRouteId.current.set(route.id, models);
      setAvailableModels(models);
      setModelStatus(result.message);
    } catch (discoverError) {
      if (requestVersion !== modelRequestVersion.current) return;
      const message =
        discoverError instanceof Error
          ? discoverError.message
          : "无法获取模型列表";
      setModelStatus(`${message}；已保留该路由的建议模型。`);
    } finally {
      if (requestVersion === modelRequestVersion.current) {
        setDiscovering(false);
      }
    }
  };

  const loadRoute = (route: ModelRoute) => {
    invalidateModelDiscovery();
    setSelectedRouteId(route.id);
    setDraft(routeToDraft(route));
    setCredential("");
    setClearCredential(false);
    setAvailableModels(modelsFor(route.provider, route.model));
    setModelStatus("正在同步该路由的模型列表…");
    setTestResult(null);
    setError("");
    void loadSavedRouteModels(route);
  };

  const activateAndLoadRoute = async (routeId: string) => {
    const requestedRoute = settings.routes.find((route) => route.id === routeId);
    if (!requestedRoute) return;

    invalidateModelDiscovery();
    setRouteSwitching(true);
    setPendingRouteId(null);
    setError("");
    try {
      const next =
        routeId === settings.activeRouteId
          ? settings
          : await window.promptFloat.activateRoute(routeId);
      onSaved(next);
      const activeRoute =
        next.routes.find((route) => route.id === next.activeRouteId) ||
        requestedRoute;
      loadRoute(activeRoute);
    } catch (switchError) {
      setError(
        switchError instanceof Error ? switchError.message : "切换模型路由失败",
      );
    } finally {
      setRouteSwitching(false);
    }
  };

  const handleSavedRouteChange = (routeId: string) => {
    if (routeId === selectedRouteId) return;
    if (hasUnsavedChanges) {
      setPendingRouteId(routeId);
      return;
    }
    void activateAndLoadRoute(routeId);
  };

  const handleProviderChange = (providerId: ModelProviderId) => {
    invalidateModelDiscovery();
    const nextProvider = getProviderDefinition(providerId);
    const nextModels = [...nextProvider.fallbackModels];
    setDraft((current) => ({
      ...current,
      provider: providerId,
      baseUrl: nextProvider.defaultBaseUrl,
      model: nextModels[0] || current.model,
      confirmedApiHost: undefined,
      credential: undefined,
      clearCredential: undefined,
    }));
    setCredential("");
    setClearCredential(false);
    setAvailableModels(modelsFor(providerId, nextModels[0] || draft.model));
    setModelStatus(
      nextModels.length > 0
        ? `已显示 ${nextProvider.label} 的建议模型，可刷新实时列表。`
        : "请输入接口地址和模型名称，或使用“刷新模型列表”。",
    );
    setTestResult(null);
    setError("");
  };

  const handleDiscoverModels = async () => {
    const requestVersion = ++modelRequestVersion.current;
    setDiscovering(true);
    setError("");
    try {
      const result: ModelDiscoveryResult = await window.promptFloat.discoverModels(
        buildRouteInput(),
      );
      if (requestVersion !== modelRequestVersion.current) return;
      const models = mergeModels(draft.model, result.models);
      if (draft.id) modelCatalogByRouteId.current.set(draft.id, models);
      setAvailableModels(models);
      setModelStatus(result.message);
    } catch (discoverError) {
      if (requestVersion !== modelRequestVersion.current) return;
      setError(
        discoverError instanceof Error
          ? discoverError.message
          : "无法获取模型列表",
      );
    } finally {
      if (requestVersion === modelRequestVersion.current) {
        setDiscovering(false);
      }
    }
  };

  const handleTest = async () => {
    if (selectedRoute?.credentialNeedsReentry && !hasEnteredCredential) {
      setError("旧凭据无法解密；请在上方输入新 Key，点击“保存并启用”后再测试路由");
      return;
    }
    setTesting(true);
    setError("");
    setTestResult(null);
    try {
      setTestResult(await window.promptFloat.testRoute(buildSettingsInput()));
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "路由测试失败");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setError("");
    if (
      draft.engine === "direct" &&
      !clearCredential &&
      !hasEnteredCredential &&
      !storedCredentialUsable
    ) {
      setError(
        selectedRoute?.credentialNeedsReentry
          ? "已保存的 API Key 无法解密，请重新填写后再保存"
          : selectedRoute?.hasCredential
          ? "供应商、运行模式或 API 地址已改变，请重新填写 API Key 后再保存"
          : "请填写 API Key 后再保存直连路由",
      );
      return;
    }

    setSaving(true);
    try {
      const next = await window.promptFloat.saveSettings(buildSettingsInput());
      const savedRoute = next.routes.find(
        (route) => route.id === next.activeRouteId,
      );
      if (hasEnteredCredential && !savedRoute?.hasCredential) {
        throw new Error(`${credentialLabel} 未能安全保存，请重新填写后重试`);
      }
      onSaved(next);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "设置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleNewRoute = () => {
    invalidateModelDiscovery();
    const next = newRouteDraft();
    setSelectedRouteId("new");
    setPendingRouteId(null);
    setDraft(next);
    setCredential("");
    setClearCredential(false);
    setAvailableModels(modelsFor(next.provider, next.model));
    setModelStatus("已创建未保存的路由草稿。");
    setTestResult(null);
    setError("");
  };

  const handleDelete = async () => {
    if (!draft.id) return;
    setDeleting(true);
    setError("");
    try {
      const next = await window.promptFloat.deleteRoute(draft.id);
      onSaved(next);
      const nextRoute =
        next.routes.find((route) => route.id === next.activeRouteId) ||
        next.routes[0]!;
      setPendingRouteId(null);
      loadRoute(nextRoute);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除路由失败");
    } finally {
      setDeleting(false);
    }
  };


  useEffect(() => {
    if (initialModelLoadStarted.current || !initialRoute) return;
    initialModelLoadStarted.current = true;
    void loadSavedRouteModels(initialRoute);
  }, [initialRoute]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog route-settings-dialog"
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby="settings-title"
        aria-describedby="settings-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">MODEL CONNECTIONS</p>
            <h2 id="settings-title">模型路由设置</h2>
            <p className="dialog-description" id="settings-description">
              选择 AI 服务与模型。连接、安全和用量设置会分别保存。
            </p>
          </div>
          <button
            aria-label="关闭设置"
            className="icon-button"
            data-jelly
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="dialog-scroll">

        <RoutePickerSection
          settings={settings}
          selectedRouteId={selectedRouteId}
          disabled={routeSwitching || saving || testing || deleting}
          pendingRoute={pendingRoute}
          bindingPrefix={routeBindingPrefix}
          model={draft.model}
          engine={draft.engine}
          requestPath={requestPath}
          onSelectRoute={handleSavedRouteChange}
          onNewRoute={handleNewRoute}
          onDismissPending={() => setPendingRouteId(null)}
          onConfirmPending={(routeId) => void activateAndLoadRoute(routeId)}
        />

        <ConnectionSettingsSection
          draft={draft}
          updateDraft={updateDraft}
          apiEndpoint={apiEndpoint}
          mcpEndpoint={mcpEndpoint}
          modelOptions={modelOptions}
          modelStatus={modelStatus}
          credential={credential}
          clearCredential={clearCredential}
          storedCredentialUsable={storedCredentialUsable}
          credentialStatus={credentialStatus}
          saving={saving}
          testing={testing}
          deleting={deleting}
          routeSwitching={routeSwitching}
          discovering={discovering}
          onOpenApiKeySetup={onOpenApiKeySetup}
          onProviderChange={handleProviderChange}
          onDiscoverModels={() => void handleDiscoverModels()}
          onCredentialChange={(value) => {
            setCredential(value);
            setTestResult(null);
            setError("");
          }}
          onToggleClearCredential={() => {
            setClearCredential((current) => !current);
            setTestResult(null);
            setError("");
          }}
        />

        <section className="settings-section route-test-section" aria-labelledby="route-test-title">
          <div className="section-heading">
            <span className="section-index">03</span>
            <span>
              <strong id="route-test-title">连接测试</strong>
              <small>保存前先确认模型能够正常响应</small>
            </span>
          </div>

        <RouteTestPanel testing={testing} result={testResult} />
        {testResult?.ok && hasEnteredCredential && (
          <p className="security-note" role="status">
            本次测试使用了尚未保存的新凭据；点击“保存并启用”后，优化请求才会使用它。
          </p>
        )}

        </section>

        <details className="advanced-settings">
          <summary data-jelly>
            <span>
              <strong>高级设置与费用保护</strong>
              <small>请求次数、输出长度和每日预算</small>
            </span>
            <i aria-hidden="true" />
          </summary>
          <div className="advanced-settings-content">
        <UsageLimitsPanel
          maxRequestsPerHour={maxRequestsPerHour}
          maxOutputTokens={maxOutputTokens}
          dailyTokenBudget={dailyTokenBudget}
          onMaxRequestsPerHourChange={setMaxRequestsPerHour}
          onMaxOutputTokensChange={setMaxOutputTokens}
          onDailyTokenBudgetChange={setDailyTokenBudget}
        />
        <DiagnosticsPanel />

        <p className="security-note trust-note">
          远程地址必须使用 HTTPS；HTTP 只允许本机。每条路由的凭据由系统安全存储加密，并绑定供应商和目标地址；切换目标不会复用旧 Key。
        </p>
          </div>
        </details>

        </div>

        <footer className="dialog-footer">
        {error && (
          <p className="inline-error" role="alert">
            <AlertIcon />
            <span>{error}</span>
          </p>
        )}

        <div className="dialog-actions route-dialog-actions">
          {draft.id && settings.routes.length > 1 && (
            <button
              className="danger-button"
              data-jelly
              type="button"
              disabled={saving || testing || deleting || routeSwitching}
              onClick={() => void handleDelete()}
            >
              {deleting ? "删除中…" : "删除路由"}
            </button>
          )}
          <button className="secondary-button" data-jelly type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="secondary-button"
            data-jelly
            type="button"
            disabled={
              saving ||
              testing ||
              discovering ||
              routeSwitching ||
              !domainConfirmed ||
              !draft.model.trim()
            }
            onClick={() => void handleTest()}
          >
            {testing ? "测试中…" : "测试路由"}
          </button>
          <button
            className="primary-button"
            data-jelly
            type="button"
            disabled={
              saving ||
              testing ||
              discovering ||
              routeSwitching ||
              !domainConfirmed ||
              !draft.model.trim()
            }
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "保存并启用"}
          </button>
        </div>
        </footer>
      </section>
    </div>
  );
}
