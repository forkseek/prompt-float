import {
  app,
  dialog,
  net,
  screen,
  session,
  type BrowserWindow,
} from "electron";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DiagnosticsEvent,
  DiagnosticsExportResult,
  DiagnosticsReport,
  PublicSettings,
} from "../../shared/types";
import { writeJsonFileRecoverably } from "../infrastructure/jsonFile";
import {
  formatDiagnosticLine,
  sanitizeDiagnosticDetails,
} from "./diagnosticSanitizer";

const MAX_LOG_BYTES = 1_000_000;
const MAX_RECENT_EVENTS = 200;
const LOG_FILE_NAME = "prompt-float.log";
const PROXY_TIMEOUT_MS = 3_000;

let logFilePath = "";
let writeQueue: Promise<void> = Promise.resolve();
const recentEvents: DiagnosticsEvent[] = [];

async function rotateLogIfNeeded(): Promise<void> {
  if (!logFilePath) return;
  try {
    const stat = await fs.stat(logFilePath);
    if (stat.size < MAX_LOG_BYTES) return;
    const previousPath = `${logFilePath}.1`;
    await fs.rm(previousPath, { force: true });
    await fs.rename(logFilePath, previousPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Unable to rotate diagnostics log");
    }
  }
}

export async function initializeDiagnostics(): Promise<void> {
  const logsDirectory = app.getPath("logs");
  await fs.mkdir(logsDirectory, { recursive: true });
  logFilePath = path.join(logsDirectory, LOG_FILE_NAME);
  await rotateLogIfNeeded();
}

export function recordDiagnostic(
  level: DiagnosticsEvent["level"],
  code: string,
  details: Record<string, unknown> = {},
): void {
  const event: DiagnosticsEvent = {
    timestamp: new Date().toISOString(),
    level,
    code: code.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80),
    details: sanitizeDiagnosticDetails(details),
  };
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();

  writeQueue = writeQueue
    .then(async () => {
      if (!logFilePath) await initializeDiagnostics();
      await rotateLogIfNeeded();
      await fs.appendFile(logFilePath, formatDiagnosticLine(event), {
        encoding: "utf8",
        mode: 0o600,
      });
    })
    .catch(() => undefined);
}

function selectedRoute(settings: PublicSettings) {
  return (
    settings.routes.find((route) => route.id === settings.activeRouteId) ||
    settings.routes[0]
  );
}

async function resolveProxy(targetUrl: string): Promise<string> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      session.defaultSession.resolveProxy(targetUrl),
      new Promise<string>((resolve) => {
        timeout = setTimeout(() => resolve("TIMEOUT"), PROXY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return "UNAVAILABLE";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getDiagnosticsReport(
  window: BrowserWindow | null,
  settings: PublicSettings,
): Promise<DiagnosticsReport> {
  const route = selectedRoute(settings);
  const targetUrl = route
    ? route.engine === "direct"
      ? route.baseUrl
      : route.mcpUrl
    : "https://example.invalid";
  const proxy = await resolveProxy(targetUrl);

  return {
    generatedAt: new Date().toISOString(),
    application: {
      version: app.getVersion(),
      electronVersion: process.versions.electron || "unknown",
      nodeVersion: process.versions.node,
      packaged: app.isPackaged,
    },
    system: {
      platform: process.platform,
      release: os.release(),
      architecture: process.arch,
      online: net.isOnline(),
    },
    activeRoute: route
      ? {
          engine: route.engine,
          provider: route.provider,
          model: route.model,
          host: route.engine === "direct" ? route.apiHost : route.mcpHost,
          proxy,
        }
      : null,
    window:
      window && !window.isDestroyed()
        ? {
            bounds: window.getBounds(),
            maximized: window.isMaximized(),
            minimized: window.isMinimized(),
            alwaysOnTop: window.isAlwaysOnTop(),
          }
        : null,
    displays: screen.getAllDisplays().map((display) => ({
      id: display.id,
      label: display.label || `Display ${display.id}`,
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
    })),
    recentEvents: recentEvents.map((event) => ({
      ...event,
      details: { ...event.details },
    })),
  };
}

function exportFileName(): string {
  return `Prompt-Float-Diagnostics-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
}

export async function exportDiagnosticsReport(
  window: BrowserWindow | null,
  report: DiagnosticsReport,
): Promise<DiagnosticsExportResult> {
  const options = {
    title: "导出 Prompt Float 诊断报告",
    defaultPath: path.join(app.getPath("documents"), exportFileName()),
    filters: [{ name: "JSON 诊断报告", extensions: ["json"] }],
  };
  const selection = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (selection.canceled || !selection.filePath) return { saved: false };
  await writeJsonFileRecoverably(selection.filePath, report);
  return { saved: true, fileName: path.basename(selection.filePath) };
}
