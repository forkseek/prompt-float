import { useMemo, useState } from "react";
import {
  API_KEY_PROVIDER_IDS,
  API_KEY_PROVIDERS,
  getProviderDefinition,
  type ApiKeyProviderId,
} from "../../shared/providers";
import type { PublicSettings } from "../../shared/types";
import type { ApiKeyDialogOrigin } from "../hooks/useAppDialogs";
import { useModalFocus } from "../hooks/useModalFocus";
import {
  AlertIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CloseIcon,
  LockIcon,
} from "./Icons";

interface ApiKeySetupDialogProps {
  origin: ApiKeyDialogOrigin;
  settings: PublicSettings;
  onClose: () => void;
  onSettingsChanged: (settings: PublicSettings) => void;
}

function isApiKeyProvider(value: string | undefined): value is ApiKeyProviderId {
  return API_KEY_PROVIDER_IDS.includes(value as ApiKeyProviderId);
}

export function ApiKeySetupDialog({
  origin,
  settings,
  onClose,
  onSettingsChanged,
}: ApiKeySetupDialogProps) {
  const activeRoute =
    settings.routes.find((route) => route.id === settings.activeRouteId) ||
    settings.routes[0];
  const [selectedProvider, setSelectedProvider] = useState<ApiKeyProviderId>(
    isApiKeyProvider(activeRoute?.provider) ? activeRoute.provider : "openai",
  );
  const [credential, setCredential] = useState("");
  const [confirmedApiHost, setConfirmedApiHost] = useState("");
  const [saving, setSaving] = useState(false);
  const [openingLink, setOpeningLink] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dialogRef = useModalFocus<HTMLElement>(
    onClose,
    '[role="tab"][aria-selected="true"]',
  );

  const provider = getProviderDefinition(selectedProvider);
  const apiHost = useMemo(
    () => new URL(provider.defaultBaseUrl).hostname.toLowerCase(),
    [provider.defaultBaseUrl],
  );
  const configuredProviders = useMemo(
    () =>
      new Set(
        settings.routes
          .filter((route) => route.engine === "direct" && route.hasCredential)
          .map((route) => route.provider),
      ),
    [settings.routes],
  );
  const isFirstLaunch = origin === "first-launch";
  const canSave =
    Boolean(credential.trim()) &&
    confirmedApiHost === apiHost &&
    !saving &&
    !openingLink;

  const selectProvider = (providerId: ApiKeyProviderId) => {
    setSelectedProvider(providerId);
    setCredential("");
    setConfirmedApiHost("");
    setError("");
    setSuccess("");
  };

  const openApiKeyPage = async () => {
    setOpeningLink(true);
    setError("");
    try {
      await window.promptFloat.openProviderApiKeyPage(selectedProvider);
    } catch (linkError) {
      setError(
        linkError instanceof Error
          ? linkError.message
          : "无法打开供应商 API Key 页面",
      );
    } finally {
      setOpeningLink(false);
    }
  };

  const saveApiKey = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const next = await window.promptFloat.saveProviderApiKey({
        provider: selectedProvider,
        credential: credential.trim(),
        confirmedApiHost,
      });
      const savedRoute = next.routes.find(
        (route) =>
          route.id === next.activeRouteId &&
          route.provider === selectedProvider &&
          route.hasCredential,
      );
      if (!savedRoute) {
        throw new Error("API Key 未能安全保存，请重新填写后重试");
      }
      setCredential("");
      setSuccess(
        `${provider.label} 已安全保存并设为当前路由。你可以继续配置其他供应商，或完成设置。`,
      );
      onSettingsChanged(next);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "API Key 保存失败",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-describedby="api-key-setup-description"
        aria-labelledby="api-key-setup-title"
        aria-modal="true"
        className="settings-dialog api-key-setup-dialog"
        ref={dialogRef}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading api-key-setup-heading">
          <div>
            <p className="eyebrow">
              {isFirstLaunch ? "FIRST START" : "PROVIDER CREDENTIALS"}
            </p>
            <h2 id="api-key-setup-title">API Key 配置</h2>
            <p className="dialog-description" id="api-key-setup-description">
              选择供应商、前往官方页面申请 Key，再由系统安全存储。
            </p>
          </div>
          <button
            aria-label={isFirstLaunch ? "稍后设置" : "关闭 API Key 配置"}
            className="icon-button"
            data-jelly
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="api-key-setup-body">
          <nav
            aria-label="API Key 供应商"
            className="api-key-provider-list"
            role="tablist"
          >
            {API_KEY_PROVIDERS.map((candidate) => {
              const configured = configuredProviders.has(candidate.id);
              return (
                <button
                  aria-controls="api-key-provider-panel"
                  aria-selected={selectedProvider === candidate.id}
                  className={
                    selectedProvider === candidate.id ? "is-selected" : ""
                  }
                  data-jelly
                  id={`api-key-provider-${candidate.id}`}
                  key={candidate.id}
                  role="tab"
                  tabIndex={selectedProvider === candidate.id ? 0 : -1}
                  type="button"
                  onClick={() => selectProvider(candidate.id)}
                >
                  <span className="provider-initial" aria-hidden="true">
                    {candidate.label.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{candidate.label}</strong>
                    <small>{configured ? "已保存凭据" : "待配置"}</small>
                  </span>
                  {configured && (
                    <span className="provider-configured" aria-label="已配置">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div
            aria-labelledby={`api-key-provider-${selectedProvider}`}
            className="api-key-provider-panel"
            id="api-key-provider-panel"
            role="tabpanel"
          >
            <div className="provider-panel-heading">
              <div>
                <span className="provider-panel-kicker">当前供应商</span>
                <h3>{provider.label}</h3>
              </div>
              {configuredProviders.has(selectedProvider) && (
                <span className="configured-pill">
                  <CheckIcon />
                  已配置
                </span>
              )}
            </div>

            <div className="provider-route-preview">
              <span>
                <small>API 请求域名</small>
                <code>{apiHost}</code>
              </span>
              <span>
                <small>默认模型</small>
                <strong>{provider.fallbackModels[0]}</strong>
              </span>
            </div>

            <button
              aria-label={`打开 ${provider.label} API Key 申请网站`}
              className="provider-link-button"
              data-jelly
              disabled={openingLink || saving}
              type="button"
              onClick={() => void openApiKeyPage()}
            >
              <span>
                <strong>前往官方 API Key 页面</strong>
                <small>使用系统默认浏览器打开，不会把 Key 带回网页</small>
              </span>
              <ArrowUpRightIcon />
            </button>

            <label className="field-label">
              {provider.credentialLabel}
              <input
                aria-label="API Key"
                autoComplete="new-password"
                placeholder="粘贴后点击保存；已保存的 Key 不会再次显示"
                type="password"
                value={credential}
                onChange={(event) => {
                  setCredential(event.target.value);
                  setError("");
                  setSuccess("");
                }}
              />
            </label>

            {activeRoute?.engine === "direct" &&
              activeRoute.provider === selectedProvider &&
              activeRoute.credentialNeedsReentry &&
              !success && (
                <p className="credential-status warning" role="status">
                  旧 Key 已无法解密。填入新 Key、勾选下方域名确认，再点击“保存此供应商”；仅关闭窗口不会更新路由。
                </p>
              )}

            <label className="check-row domain-confirmation api-key-domain-confirmation">
              <input
                checked={confirmedApiHost === apiHost}
                type="checkbox"
                onChange={(event) => {
                  setConfirmedApiHost(event.target.checked ? apiHost : "");
                  setError("");
                }}
              />
              我确认 API Key 和提示词将发送到 {apiHost}
            </label>

            <p className="api-key-security-note">
              <LockIcon />
              <span>
                Key 由 Electron safeStorage 加密并绑定供应商与请求地址；界面和 IPC
                返回值不会回显明文。
              </span>
            </p>

            {success && (
              <p className="inline-success api-key-inline-status" role="status">
                <CheckIcon />
                <span>{success}</span>
              </p>
            )}
            {error && (
              <p className="inline-error api-key-inline-status" role="alert">
                <AlertIcon />
                <span>{error}</span>
              </p>
            )}
          </div>
        </div>

        <footer className="dialog-footer api-key-setup-footer">
          <p>
            {isFirstLaunch && !settings.apiKeyOnboardingCompleted
              ? "稍后设置只关闭本次提示；下次启动仍会首先提醒。"
              : "还可在“设置 → API Key 快速配置”中随时回来修改。"}
          </p>
          <div className="dialog-actions">
            <button
              className="secondary-button"
              data-jelly
              disabled={saving}
              type="button"
              onClick={onClose}
            >
              {isFirstLaunch && !settings.apiKeyOnboardingCompleted
                ? "稍后设置"
                : isFirstLaunch
                  ? "完成并开始使用"
                  : "返回设置"}
            </button>
            <button
              className="primary-button"
              data-jelly
              disabled={!canSave}
              type="button"
              onClick={() => void saveApiKey()}
            >
              {saving ? "安全保存中…" : "保存此供应商"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
