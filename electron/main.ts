import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { cancelAllRequests, registerIpcHandlers } from "./ipc/registerHandlers";
import { hardenProductionRendererSession } from "./security/rendererNetwork";
import {
  installPackagedRendererProtocol,
  registerPackagedRendererScheme,
} from "./security/rendererProtocol";
import { resolveRendererTarget } from "./security/rendererTrust";
import { initializeDiagnostics, recordDiagnostic } from "./services/diagnostics";
import { configureAutoUpdates } from "./services/updateManager";

let mainWindow: BrowserWindow | null = null;

const userDataOverride = process.env.PROMPT_FLOAT_USER_DATA_DIR;
if (userDataOverride && path.isAbsolute(userDataOverride)) {
  app.setPath("userData", path.resolve(userDataOverride));
}

const rendererFilePath = path.join(
  __dirname,
  "..",
  "..",
  "dist",
  "index.html",
);
const rendererTarget = resolveRendererTarget({
  packaged: app.isPackaged,
  rendererFilePath,
  developmentServerUrl: process.env.VITE_DEV_SERVER_URL,
});

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: "#101218",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  recordDiagnostic("info", "window.created", {
    width: 980,
    height: 720,
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    recordDiagnostic("error", "renderer.gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.on("unresponsive", () =>
    recordDiagnostic("warning", "window.unresponsive"),
  );
  mainWindow.on("responsive", () =>
    recordDiagnostic("info", "window.responsive"),
  );

  if (rendererTarget.kind === "file") {
    await mainWindow.loadFile(rendererTarget.filePath);
  } else {
    await mainWindow.loadURL(rendererTarget.url);
  }

  mainWindow.once("ready-to-show", () => {
    recordDiagnostic("info", "window.ready");
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    cancelAllRequests();
    recordDiagnostic("info", "window.closed");
    mainWindow = null;
  });
}

async function startApplication(): Promise<void> {
  await initializeDiagnostics().catch(() => undefined);
  recordDiagnostic("info", "application.started", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
  });
  if (app.isPackaged) {
    await installPackagedRendererProtocol(path.dirname(rendererFilePath));
    hardenProductionRendererSession(
      session.defaultSession,
      rendererTarget.trustedUrl,
    );
  }
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  await createWindow();
  await configureAutoUpdates();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (app.isPackaged) registerPackagedRendererScheme();
  app.on("second-instance", () => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  registerIpcHandlers(() => mainWindow, rendererTarget.trustedUrl);
  void app.whenReady().then(startApplication).catch((error: unknown) => {
    console.error("Prompt Float startup failed", error);
    app.quit();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
