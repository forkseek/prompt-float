import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ThemePreference } from "../../shared/types";
import {
  CloseIcon,
  HistoryIcon,
  MinimizeIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
} from "./Icons";

interface TitleBarProps {
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  resolvedTheme: "light" | "dark";
  settingsDisabled?: boolean;
  theme: ThemePreference;
  themeDisabled?: boolean;
}

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  if (theme === "light") return <SunIcon />;
  if (theme === "dark") return <MoonIcon />;
  return <MonitorIcon />;
}

export function TitleBar({
  onOpenHistory,
  onOpenSettings,
  onThemeChange,
  resolvedTheme,
  settingsDisabled = false,
  theme,
  themeDisabled = false,
}: TitleBarProps) {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeControlRef = useRef<HTMLDivElement>(null);
  const themeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!themeMenuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!themeControlRef.current?.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setThemeMenuOpen(false);
        themeButtonRef.current?.focus();
      }
    };

    window.requestAnimationFrame(() => {
      themeControlRef.current
        ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
        ?.focus();
    });

    window.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [themeMenuOpen]);

  const selectTheme = (nextTheme: ThemePreference) => {
    onThemeChange(nextTheme);
    setThemeMenuOpen(false);
    window.requestAnimationFrame(() => themeButtonRef.current?.focus());
  };

  const navigateThemeMenu = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
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

  return (
    <header className="title-bar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <SparklesIcon />
        </span>
        <span className="brand-copy">
          <strong>Prompt Float</strong>
          <small>智能提示词助手</small>
        </span>
      </div>

      <div className="window-actions no-drag">
        <div className="theme-control" ref={themeControlRef}>
          <button
            aria-expanded={themeMenuOpen}
            aria-haspopup="menu"
            aria-label={`选择界面主题，当前${THEME_LABELS[theme]}`}
            className="icon-button"
            data-jelly
            disabled={themeDisabled}
            ref={themeButtonRef}
            title={`界面主题：${THEME_LABELS[theme]}（当前显示${resolvedTheme === "light" ? "浅色" : "深色"}）`}
            type="button"
            onClick={() => setThemeMenuOpen((current) => !current)}
          >
            <ThemeIcon theme={theme} />
          </button>

          {themeMenuOpen && (
            <div
              aria-label="界面主题"
              className="theme-popover"
              role="menu"
              onKeyDown={navigateThemeMenu}
            >
              <p>界面主题</p>
              {(["system", "light", "dark"] as const).map((option) => (
                <button
                  aria-checked={theme === option}
                  className={theme === option ? "active" : ""}
                  data-jelly
                  key={option}
                  role="menuitemradio"
                  type="button"
                  onClick={() => selectTheme(option)}
                >
                  <ThemeIcon theme={option} />
                  <span>{THEME_LABELS[option]}</span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          aria-label="打开历史记录"
          className="icon-button"
          data-jelly
          disabled={settingsDisabled}
          title="历史记录"
          type="button"
          onClick={onOpenHistory}
        >
          <HistoryIcon />
        </button>
        <button
          aria-label="打开设置"
          className="icon-button"
          data-jelly
          disabled={settingsDisabled}
          title="模型与连接设置"
          type="button"
          onClick={onOpenSettings}
        >
          <SettingsIcon />
        </button>
        <button
          aria-label="最小化窗口"
          className="icon-button"
          data-jelly
          title="最小化"
          type="button"
          onClick={() => void window.promptFloat.minimizeWindow()}
        >
          <MinimizeIcon />
        </button>
        <button
          aria-label="关闭窗口"
          className="icon-button close-button"
          data-jelly
          title="关闭"
          type="button"
          onClick={() => void window.promptFloat.closeWindow()}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
