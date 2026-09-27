import {
  getProviderDefinition,
  PROVIDERS,
  type ModelProviderId,
} from "../../../shared/providers";
import type { RouteInput } from "../../../shared/types";
import { CheckIcon } from "../Icons";
import type { EndpointPreview } from "../routeDraft";

interface ConnectionSettingsSectionProps {
  draft: RouteInput;
  updateDraft: (update: Partial<RouteInput>) => void;
  apiEndpoint: EndpointPreview | null;
  mcpEndpoint: EndpointPreview | null;
  modelOptions: string[];
  modelStatus: string;
  credential: string;
  clearCredential: boolean;
  storedCredentialUsable: boolean;
  credentialStatus: { state: string; message: string };
  saving: boolean;
  testing: boolean;
  deleting: boolean;
  routeSwitching: boolean;
  discovering: boolean;
  onOpenApiKeySetup: () => void;
  onProviderChange: (providerId: ModelProviderId) => void;
  onDiscoverModels: () => void;
  onCredentialChange: (value: string) => void;
  onToggleClearCredential: () => void;
}

export function ConnectionSettingsSection({
  draft,
  updateDraft,
  apiEndpoint,
  mcpEndpoint,
  modelOptions,
  modelStatus,
  credential,
  clearCredential,
  storedCredentialUsable,
  credentialStatus,
  saving,
  testing,
  deleting,
  routeSwitching,
  discovering,
  onOpenApiKeySetup,
  onProviderChange,
  onDiscoverModels,
  onCredentialChange,
  onToggleClearCredential,
}: ConnectionSettingsSectionProps) {
  const provider = getProviderDefinition(draft.provider);
  const renderEndpointConfirmation = (
    endpoint: EndpointPreview | null,
    confirmed: string | undefined,
    onConfirmed: (value: string | undefined) => void,
    dataDescription: string,
  ) => (
    <>
      <div className="endpoint-summary" aria-live="polite">
        {endpoint ? (
          <>
            <span>数据发送目标</span>
            <strong>{endpoint.displayHost}</strong>
          </>
        ) : (
          <span>请输入完整的服务地址</span>
        )}
      </div>
      {endpoint && !endpoint.isLoopback && (
        <label className="check-row domain-confirmation">
          <input
            type="checkbox"
            checked={confirmed === endpoint.hostname}
            onChange={(event) =>
              onConfirmed(event.target.checked ? endpoint.hostname : undefined)
            }
          />
          我确认{dataDescription}将发送到 {endpoint.hostname}
        </label>
      )}
    </>
  );

  return (
        <section className="settings-section" aria-labelledby="connection-settings-title">
          <div className="section-heading">
            <span className="section-index">02</span>
            <span>
              <strong id="connection-settings-title">连接与模型</strong>
              <small>普通用户通常只需确认供应商、地址和模型</small>
            </span>
          </div>

        <div className="api-key-settings-entry">
          <span>
            <strong>API Key 快速配置</strong>
            <small>按供应商打开官方申请页，并安全保存对应密钥</small>
          </span>
          <button
            className="secondary-button"
            data-jelly
            type="button"
            disabled={saving || testing || deleting || routeSwitching}
            onClick={onOpenApiKeySetup}
          >
            打开快速配置
          </button>
        </div>

        <label className="field-label">
          路由名称
          <input
            aria-label="路由名称"
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
            placeholder="例如：OpenAI 写作路由"
          />
        </label>

        <div className="engine-switch" role="radiogroup" aria-label="优化引擎">
          <button
            data-jelly
            type="button"
            role="radio"
            aria-checked={draft.engine === "prompt-optimizer-mcp"}
            className={draft.engine === "prompt-optimizer-mcp" ? "active" : ""}
            onClick={() => updateDraft({ engine: "prompt-optimizer-mcp" })}
          >
            Prompt Optimizer MCP
          </button>
          <button
            data-jelly
            type="button"
            role="radio"
            aria-checked={draft.engine === "direct"}
            className={draft.engine === "direct" ? "active" : ""}
            onClick={() => updateDraft({ engine: "direct" })}
          >
            直连模型 API
          </button>
        </div>

        <label className="field-label">
          供应商
          <select
            aria-label="供应商"
            value={draft.provider}
            onChange={(event) =>
              onProviderChange(event.target.value as ModelProviderId)
            }
          >
            {PROVIDERS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>

        {draft.engine === "direct" ? (
          <>
            <label className="field-label">
              API 地址
              <input
                aria-label="API 地址"
                value={draft.baseUrl}
                onChange={(event) =>
                  updateDraft({
                    baseUrl: event.target.value,
                    confirmedApiHost: undefined,
                  })
                }
                placeholder={provider.defaultBaseUrl}
              />
            </label>
            {renderEndpointConfirmation(
              apiEndpoint,
              draft.confirmedApiHost,
              (confirmedApiHost) => updateDraft({ confirmedApiHost }),
              " API Key 和提示词",
            )}
          </>
        ) : (
          <>
            <label className="field-label">
              Streamable HTTP MCP 地址
              <input
                aria-label="MCP 地址"
                value={draft.mcpUrl}
                onChange={(event) =>
                  updateDraft({
                    mcpUrl: event.target.value,
                    confirmedMcpHost: undefined,
                  })
                }
                placeholder="http://127.0.0.1:3000/mcp"
              />
            </label>
            {renderEndpointConfirmation(
              mcpEndpoint,
              draft.confirmedMcpHost,
              (confirmedMcpHost) => updateDraft({ confirmedMcpHost }),
              "提示词和 MCP 协议数据",
            )}
          </>
        )}

        <div className="model-row">
          <label className="field-label">
            供应商模型
            <select
              aria-label="供应商模型"
              value={modelOptions.includes(draft.model) ? draft.model : "__custom__"}
              onChange={(event) => {
                if (event.target.value === "__custom__") {
                  updateDraft({ model: "" });
                } else {
                  updateDraft({ model: event.target.value });
                }
              }}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              <option value="__custom__">手动填写模型名称…</option>
            </select>
          </label>
          <button
            className="secondary-button refresh-models-button"
            data-jelly
            type="button"
            disabled={discovering || testing || saving || routeSwitching}
            onClick={() => void onDiscoverModels()}
          >
            {discovering ? "刷新中…" : "刷新模型"}
          </button>
        </div>
        <label className="field-label">
          模型名称（可手动填写）
          <input
            aria-label="模型名称"
            value={draft.model}
            onChange={(event) => updateDraft({ model: event.target.value })}
            placeholder="选择或填写接口支持的模型名称"
          />
        </label>
        {modelStatus && <p className="model-status">{modelStatus}</p>}

        <label className="field-label">
          {draft.engine === "direct"
            ? provider.credentialLabel
            : "MCP 访问令牌（可选）"}
          <input
            aria-label={
              draft.engine === "direct" ? "API Key" : "MCP 访问令牌"
            }
            type="password"
            value={credential}
            disabled={clearCredential}
            onChange={(event) => onCredentialChange(event.target.value)}
            placeholder={
              storedCredentialUsable
                ? "已安全保存，留空不变"
                : draft.engine === "direct"
                  ? "切换供应商或地址后，请填写该路由的 Key"
                  : "如 MCP 服务要求 Bearer Token，请填写"
            }
            autoComplete="off"
            aria-describedby="credential-save-status"
          />
        </label>
        <p
          id="credential-save-status"
          className={`credential-status ${credentialStatus.state}`}
          role="status"
          aria-live="polite"
        >
          {credentialStatus.state === "saved" && <CheckIcon />}
          <span>{credentialStatus.message}</span>
        </p>
        {storedCredentialUsable && (
          <button
            aria-pressed={clearCredential}
            className={`credential-clear-button ${clearCredential ? "is-pending" : ""}`}
            data-jelly
            type="button"
            onClick={onToggleClearCredential}
          >
            {clearCredential ? "撤销清除凭据" : "清除已保存凭据"}
          </button>
        )}

        {draft.engine === "prompt-optimizer-mcp" && (
          <p className="mcp-note">
            此路由会切换到对应 MCP 服务。供应商和模型是该服务端的配置身份；路由测试会验证服务端实际的 mcp-default 模型响应，但本软件不会私自修改远端 Core 配置。
          </p>
        )}

        </section>
  );
}
