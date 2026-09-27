import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  BudgetStatus,
  OptimizationEvent,
  OptimizationMode,
  PublicSettings,
  ThemePreference,
} from "../shared/types";
import { ApiKeySetupDialog } from "./components/ApiKeySetupDialog";
import { DiffView } from "./components/DiffView";
import { HistoryDialog } from "./components/HistoryDialog";
import { HistoryPanel } from "./components/HistoryPanel";
import {
  AlertIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  LockIcon,
  SparklesIcon,
  StopIcon,
  UndoIcon,
} from "./components/Icons";
import { SettingsDialog } from "./components/SettingsDialog";
import { RouteSwitcher } from "./components/RouteSwitcher";
import { TitleBar } from "./components/TitleBar";
import { useAppDialogs } from "./hooks/useAppDialogs";

const THEME_CACHE_KEY = "prompt-float-theme";

function cachedThemePreference(): ThemePreference {
  try {
    const cached = window.localStorage.getItem(THEME_CACHE_KEY);
    return cached === "light" || cached === "dark" || cached === "system"
      ? cached
      : "system";
  } catch {
    return "system";
  }
}

const EMPTY_SETTINGS: PublicSettings = {
  activeRouteId: "",
  routes: [],
  apiKeyOnboardingCompleted: false,
  maxRequestsPerHour: 30,
  dailyTokenBudget: 200_000,
  maxOutputTokens: 4_096,
  theme: cachedThemePreference(),
};

type ResultView = "result" | "diff" | "history";

interface PromptSnapshot {
  prompt: string;
  mode: OptimizationMode;
  requirements: string;
}

type ResolvedTheme = "light" | "dark";

function currentSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export default function App() {
  const [mode, setMode] = useState<OptimizationMode>("user");
  const [prompt, setPrompt] = useState("");
  const [requirements, setRequirements] = useState("");
  const [result, setResult] = useState("");
  const [resultView, setResultView] = useState<ResultView>("result");
  const [settings, setSettings] = useState<PublicSettings>(EMPTY_SETTINGS);
  const { dialog, closeDialog, openApiKeySetup, openHistory, openSettings } =
    useAppDialogs();
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [switchingRouteId, setSwitchingRouteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [historyWarning, setHistoryWarning] = useState("");
  const [copied, setCopied] = useState(false);
  const [requestSnapshot, setRequestSnapshot] =
    useState<PromptSnapshot | null>(null);
  const [undoStack, setUndoStack] = useState<PromptSnapshot[]>([]);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    currentSystemTheme(),
  );
  const [themeSaving, setThemeSaving] = useState(false);
  const activeRequestId = useRef<string | null>(null);

  const activeRoute = useMemo(
    () =>
      settings.routes.find((route) => route.id === settings.activeRouteId) ||
      settings.routes[0],
    [settings.activeRouteId, settings.routes],
  );
  const activeEngine = activeRoute?.engine || "direct";
  const resolvedTheme: ResolvedTheme =
    settings.theme === "system" ? systemTheme : settings.theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemTheme = () => setSystemTheme(media.matches ? "light" : "dark");
    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_CACHE_KEY, settings.theme);
    } catch {
      // The main-process settings file remains authoritative if cache is unavailable.
    }
  }, [settings.theme]);

  const refreshBudget = useCallback(() => {
    void window.promptFloat
      .getBudgetStatus()
      .then(setBudgetStatus)
      .catch((budgetError) => {
        setBudgetStatus(null);
        setError(
          budgetError instanceof Error
            ? budgetError.message
            : "无法读取用量预算，模型请求已暂停",
        );
      });
  }, []);

  const changeTheme = useCallback(
    async (nextTheme: ThemePreference) => {
      if (themeSaving || nextTheme === settings.theme) return;
      const previousTheme = settings.theme;
      setSettings((current) => ({ ...current, theme: nextTheme }));
      setThemeSaving(true);
      try {
        setSettings(await window.promptFloat.setTheme(nextTheme));
      } catch (themeError) {
        setSettings((current) => ({ ...current, theme: previousTheme }));
        setError(
          themeError instanceof Error
            ? themeError.message
            : "无法保存界面主题",
        );
      } finally {
        setThemeSaving(false);
      }
    },
    [settings.theme, themeSaving],
  );

  useEffect(() => {
    window.promptFloat
      .getSettings()
      .then((loaded) => {
        setSettings(loaded);
        refreshBudget();
        const route =
          loaded.routes.find((candidate) => candidate.id === loaded.activeRouteId) ||
          loaded.routes[0];
        if (!loaded.apiKeyOnboardingCompleted) {
          openApiKeySetup("first-launch");
        } else if (
          route?.credentialNeedsReentry ||
          (route?.engine === "direct" && !route.hasCredential)
        ) {
          if (route.credentialNeedsReentry) {
            setError("当前路由保存的凭据无法解密，请在设置中重新填写并保存。");
          }
          openSettings(route.id);
        }
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error ? loadError.message : "无法加载设置",
        ),
      );
  }, [openApiKeySetup, openSettings, refreshBudget]);

  const closeApiKeySetup = useCallback(() => {
    if (dialog?.kind === "api-key" && dialog.origin === "settings") {
      openSettings(settings.activeRouteId);
      return;
    }
    closeDialog();
  }, [closeDialog, dialog, openSettings, settings.activeRouteId]);

  useEffect(() => {
    if (activeEngine === "direct" && mode === "iterate") {
      setMode("user");
      setRequirements("");
    }
  }, [activeEngine, mode]);

  useEffect(() => {
    return window.promptFloat.onOptimizationEvent(
      (event: OptimizationEvent) => {
        if (event.requestId !== activeRequestId.current) return;

        if (event.type === "chunk") {
          setResult((current) => current + event.content);
        } else if (event.type === "complete") {
          setResult(event.content);
          setIsOptimizing(false);
          activeRequestId.current = null;
        } else if (event.type === "history-warning") {
          setHistoryWarning(event.message);
        } else {
          setError(event.message);
          setIsOptimizing(false);
          activeRequestId.current = null;
        }
      },
    );
  }, []);

  const runOptimization = useCallback(async () => {
    if (isOptimizing) return;
    if (!activeRoute) {
      setError("请先创建并保存一条模型路由");
      openSettings();
      return;
    }
    if (!prompt.trim()) {
      setError("先输入需要优化的提示词");
      return;
    }
    if (mode === "iterate" && !requirements.trim()) {
      setError("请填写本轮迭代的具体改进要求");
      return;
    }
    if (
      activeRoute.credentialNeedsReentry ||
      (activeRoute.engine === "direct" && !activeRoute.hasCredential)
    ) {
      setError(
        activeRoute.credentialNeedsReentry
          ? "当前路由保存的凭据无法解密，请重新填写并保存"
          : "请先配置当前路由的 API Key",
      );
      openSettings(activeRoute.id);
      return;
    }

    const requestId = crypto.randomUUID();
    const snapshot: PromptSnapshot = {
      prompt: prompt.trim(),
      mode,
      requirements: requirements.trim(),
    };
    activeRequestId.current = requestId;
    setRequestSnapshot(snapshot);
    setResult("");
    setError("");
    setHistoryWarning("");
    setCopied(false);
    setResultView("result");
    setIsOptimizing(true);

    try {
      await window.promptFloat.optimize({
        requestId,
        mode: snapshot.mode,
        prompt: snapshot.prompt,
        requirements: snapshot.requirements || undefined,
      });
    } catch (requestError) {
      if (activeRequestId.current === requestId) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "优化失败，请稍后重试",
        );
        setIsOptimizing(false);
        activeRequestId.current = null;
      }
    } finally {
      refreshBudget();
    }
  }, [
    activeRoute,
    isOptimizing,
    mode,
    prompt,
    requirements,
    refreshBudget,
    openSettings,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void runOptimization();
      }
      if (event.key === "Escape" && activeRequestId.current) {
        window.promptFloat.cancelOptimization(activeRequestId.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runOptimization]);

  const switchRoute = async (routeId: string): Promise<boolean> => {
    if (routeId === settings.activeRouteId) return true;
    if (isOptimizing || switchingRouteId) return false;
    setSwitchingRouteId(routeId);
    setError("");
    try {
      const next = await window.promptFloat.activateRoute(routeId);
      setSettings(next);
      refreshBudget();
      return true;
    } catch (switchError) {
      setError(
        switchError instanceof Error ? switchError.message : "切换模型路由失败",
      );
      return false;
    } finally {
      setSwitchingRouteId(null);
    }
  };

  const cancelOptimization = () => {
    if (activeRequestId.current) {
      window.promptFloat.cancelOptimization(activeRequestId.current);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await window.promptFloat.writeClipboard(result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setError("复制失败，请重试");
    }
  };

  const applyResult = () => {
    if (!result) return;
    setUndoStack((current) =>
      [...current, { prompt, mode, requirements }].slice(-20),
    );
    setPrompt(result);
    if (requestSnapshot) setMode(requestSnapshot.mode);
    setRequirements("");
    setResult("");
    setRequestSnapshot(null);
    setError("");
  };

  const undoApply = () => {
    const previous = undoStack.at(-1);
    if (!previous || isOptimizing) return;
    setPrompt(previous.prompt);
    setMode(previous.mode);
    setRequirements(previous.requirements);
    setUndoStack((current) => current.slice(0, -1));
    setResult("");
    setRequestSnapshot(null);
    setError("");
  };

  const navigateModeTabs = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    const tabList = event.currentTarget.parentElement;
    if (!tabList) return;
    const tabs = [
      ...tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    ];
    if (tabs.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget));
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <div className="app-shell">
      <TitleBar
        settingsDisabled={isOptimizing}
        onOpenHistory={openHistory}
        onOpenSettings={() => openSettings(activeRoute?.id)}
        onThemeChange={(nextTheme) => void changeTheme(nextTheme)}
        resolvedTheme={resolvedTheme}
        theme={settings.theme}
        themeDisabled={themeSaving}
      />

      <main className="workspace">
        <section className="hero-row">
          <div className="hero-copy">
            <p className="eyebrow">AI PROMPT STUDIO</p>
            <h1>把想法整理成模型能执行的指令</h1>
            <p className="hero-description">
              输入你的原始想法，AI 会帮你补全目标、约束与输出格式。
            </p>
          </div>
          <RouteSwitcher
            activeRouteId={settings.activeRouteId}
            disabled={isOptimizing}
            routes={settings.routes}
            switchingRouteId={switchingRouteId}
            onEdit={(routeId) => openSettings(routeId)}
            onManage={() => openSettings(activeRoute?.id)}
            onSwitch={switchRoute}
          />
        </section>

        <div className="mode-switch" role="tablist" aria-label="优化模式">
          <button
            aria-controls="prompt-workspace"
            aria-selected={mode === "user"}
            className={mode === "user" ? "active" : ""}
            data-jelly
            disabled={isOptimizing}
            id="mode-tab-user"
            role="tab"
            tabIndex={mode === "user" ? 0 : -1}
            type="button"
            onKeyDown={navigateModeTabs}
            onClick={() => setMode("user")}
          >
            用户提示词
          </button>
          <button
            aria-controls="prompt-workspace"
            aria-selected={mode === "system"}
            className={mode === "system" ? "active" : ""}
            data-jelly
            disabled={isOptimizing}
            id="mode-tab-system"
            role="tab"
            tabIndex={mode === "system" ? 0 : -1}
            type="button"
            onKeyDown={navigateModeTabs}
            onClick={() => setMode("system")}
          >
            系统提示词
          </button>
          {activeEngine === "prompt-optimizer-mcp" && (
            <button
              aria-controls="prompt-workspace"
              aria-selected={mode === "iterate"}
              className={mode === "iterate" ? "active" : ""}
              data-jelly
              disabled={isOptimizing}
              id="mode-tab-iterate"
              role="tab"
              tabIndex={mode === "iterate" ? 0 : -1}
              type="button"
              onKeyDown={navigateModeTabs}
              onClick={() => setMode("iterate")}
            >
              迭代优化
            </button>
          )}
        </div>

        <p
          className="mode-explanation"
          id="mode-explanation"
          role="status"
          aria-live="polite"
        >
          {mode === "user"
            ? "用户提示词：说明这一次要完成的任务、背景和期望结果；优化后适合作为发给 Agent 的单次用户消息。"
            : mode === "system"
              ? "系统提示词：规定 Agent 持续遵循的角色、职责和行为边界；优化后适合放入目标 Agent 的系统指令，通常比用户消息优先。"
              : "迭代优化：按本轮改进要求调整已有提示词，不会自动改动目标 Agent 的系统指令。"}
        </p>

        <div
          aria-labelledby={`mode-tab-${mode}`}
          aria-describedby="mode-explanation"
          className="editor-grid"
          id="prompt-workspace"
          role="tabpanel"
        >
          <section
            className={`editor-card prompt-card ${isOptimizing ? "is-locked" : ""}`}
          >
            <div className="card-heading">
              <div>
                <span className="step-number">01</span>
                <span className="card-title-copy">
                  <h2>原始提示词</h2>
                  <small>告诉 AI 你希望完成什么</small>
                </span>
              </div>
              <span className="card-meta">
                {isOptimizing && (
                  <span className="locked-badge">
                    <LockIcon />
                    已锁定快照
                  </span>
                )}
                <span className="character-count">
                  {prompt.length.toLocaleString()} 字符
                </span>
              </span>
            </div>
            <textarea
              aria-label="原始提示词"
              value={prompt}
              disabled={isOptimizing}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                mode === "system"
                  ? "例如：你是一名专业的产品经理……"
                  : mode === "iterate"
                    ? "粘贴需要继续改进的完整提示词……"
                    : "例如：帮我写一份项目计划……"
              }
              spellCheck={false}
            />
            {mode === "iterate" && (
              <label className="iterate-requirements">
                <span>本轮改进要求</span>
                <textarea
                  value={requirements}
                  disabled={isOptimizing}
                  onChange={(event) => setRequirements(event.target.value)}
                  placeholder="例如：输出格式保持一致，并使用更专业的语气"
                  spellCheck={false}
                />
              </label>
            )}
          </section>

          <section
            aria-busy={isOptimizing}
            className={`editor-card result-card ${isOptimizing ? "is-generating" : ""} ${result ? "has-result" : ""}`}
          >
            <div className="card-heading">
              <div>
                <span className="step-number accent">02</span>
                <span className="card-title-copy">
                  <h2>{resultView === "history" ? "历史记录" : "优化结果"}</h2>
                  <small>
                    {resultView === "history"
                      ? "在操作面板中找到以前的优化成果"
                      : "可直接复制，也可查看修改差异"}
                  </small>
                </span>
              </div>
              <div className="view-switch">
                <button
                  aria-pressed={resultView === "result"}
                  className={resultView === "result" ? "active" : ""}
                  data-jelly
                  type="button"
                  onClick={() => setResultView("result")}
                >
                  结果
                </button>
                <button
                  aria-pressed={resultView === "diff"}
                  className={resultView === "diff" ? "active" : ""}
                  data-jelly
                  disabled={!result}
                  type="button"
                  onClick={() => setResultView("diff")}
                >
                  差异
                </button>
                <button
                  aria-pressed={resultView === "history"}
                  className={resultView === "history" ? "active" : ""}
                  data-jelly
                  disabled={isOptimizing}
                  type="button"
                  onClick={() => setResultView("history")}
                >
                  历史
                </button>
              </div>
            </div>

            {isOptimizing && (
              <div className="generation-status" role="status" aria-live="polite">
                <span className="generation-mark" aria-hidden="true">
                  <SparklesIcon />
                </span>
                <span>
                  <strong>正在整理提示词</strong>
                  <small>原始输入已锁定，按 Esc 可停止</small>
                </span>
              </div>
            )}

            {resultView === "history" ? (
              <HistoryPanel onOpenRecord={openHistory} />
            ) : resultView === "diff" && result ? (
              <DiffView
                original={requestSnapshot?.prompt ?? prompt}
                optimized={result}
              />
            ) : (
              <div className="result-editor-wrap">
                <textarea
                  aria-label="优化结果"
                  value={result}
                  disabled={isOptimizing}
                  onChange={(event) => setResult(event.target.value)}
                  placeholder={isOptimizing ? "正在生成优化结果……" : ""}
                  spellCheck={false}
                />
                {!result && !isOptimizing && (
                  <div className="result-empty" aria-hidden="true">
                    <span><SparklesIcon /></span>
                    <strong>优化结果会出现在这里</strong>
                    <small>输入内容后，按 Ctrl + Enter 即可开始</small>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <AlertIcon />
            <span>{error}</span>
          </div>
        )}
        {historyWarning && (
          <div className="history-warning" role="status">
            <AlertIcon />
            <span>{historyWarning}</span>
          </div>
        )}

        <footer className="action-bar">
          <div className="footer-meta">
            <span className="shortcut-hint">Ctrl + Enter 开始 · Esc 停止</span>
            {budgetStatus && (
              <span className="budget-hint" title="这是本机的安全预算记录，不等同于供应商账单">
                本小时 {budgetStatus.requestsThisHour}/{budgetStatus.maxRequestsPerHour}
                <i aria-hidden="true">·</i>
                今日已计入 {budgetStatus.reservedTokensToday.toLocaleString()}/
                {budgetStatus.dailyTokenBudget.toLocaleString()} tokens
              </span>
            )}
          </div>
          <div className="action-buttons">
            <button
              className="secondary-button"
              data-jelly
              disabled={undoStack.length === 0 || isOptimizing}
              type="button"
              onClick={undoApply}
            >
              <UndoIcon />
              撤销应用
            </button>
            <button
              className="secondary-button"
              data-jelly
              disabled={!result || isOptimizing}
              type="button"
              onClick={() => void copyResult()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "已复制" : "复制结果"}
            </button>
            <button
              className="secondary-button"
              data-jelly
              disabled={!result || isOptimizing}
              type="button"
              onClick={applyResult}
            >
              <CheckIcon />
              应用结果
            </button>
            <span className="primary-action-slot">
              {isOptimizing ? (
                <button
                  className="danger-button optimize-button"
                  data-jelly
                  type="button"
                  onClick={cancelOptimization}
                >
                  <StopIcon />
                  停止优化
                </button>
              ) : (
                <button
                  className="primary-button optimize-button"
                  data-jelly
                  type="button"
                  disabled={
                    !prompt.trim() ||
                    !activeRoute ||
                    (mode === "iterate" && !requirements.trim())
                  }
                  onClick={() => void runOptimization()}
                >
                  优化提示词
                  <ArrowUpRightIcon />
                </button>
              )}
            </span>
          </div>
        </footer>
      </main>

      {dialog?.kind === "settings" && (
        <SettingsDialog
          initialRouteId={dialog.routeId}
          settings={settings}
          onClose={closeDialog}
          onOpenApiKeySetup={() => openApiKeySetup("settings")}
          onSaved={(next) => {
            setSettings(next);
            setError("");
            refreshBudget();
          }}
        />
      )}
      {dialog?.kind === "api-key" && (
        <ApiKeySetupDialog
          origin={dialog.origin}
          settings={settings}
          onClose={closeApiKeySetup}
          onSettingsChanged={(next) => {
            setSettings(next);
            setError("");
            refreshBudget();
          }}
        />
      )}
      {dialog?.kind === "history" && (
        <HistoryDialog
          initialRecordId={dialog.recordId}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
