import { app } from "electron";
import { autoUpdater, NsisUpdater } from "electron-updater";
import { promises as fs } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  pinUpdateSignatureVerifier,
  resolveTrustedUpdateConfig,
} from "../security/updateTrust";
import { recordDiagnostic } from "./diagnostics";

async function readBoundedText(filePath: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > maxBytes) {
    throw new Error("Update metadata is unavailable");
  }
  const content = await fs.readFile(filePath, "utf8");
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new Error("Update metadata is unavailable");
  }
  return content;
}

export async function configureAutoUpdates(): Promise<void> {
  if (!app.isPackaged) {
    recordDiagnostic("info", "updates.disabled", { reason: "development" });
    return;
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    recordDiagnostic("info", "updates.disabled", { reason: "portable_build" });
    return;
  }

  let trusted;
  try {
    const packageMetadata = JSON.parse(
      await readBoundedText(path.join(app.getAppPath(), "package.json"), 64_000),
    ) as unknown;
    const updaterMetadata = loadYaml(
      await readBoundedText(path.join(process.resourcesPath, "app-update.yml"), 16_000),
    );
    trusted = resolveTrustedUpdateConfig(packageMetadata, updaterMetadata);
  } catch {
    trusted = null;
  }
  if (!trusted) {
    recordDiagnostic("warning", "updates.disabled", {
      reason: "release_trust_unavailable",
    });
    return;
  }
  if (!(autoUpdater instanceof NsisUpdater)) {
    recordDiagnostic("warning", "updates.disabled", {
      reason: "signed_windows_updater_unavailable",
    });
    return;
  }

  autoUpdater.verifyUpdateCodeSignature = pinUpdateSignatureVerifier(
    trusted.publisherName,
    autoUpdater.verifyUpdateCodeSignature,
  );
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.setFeedURL(trusted.provider === "github"
    ? {
        provider: "github",
        owner: trusted.owner,
        repo: trusted.repo,
        host: trusted.host,
        protocol: trusted.protocol,
        publisherName: [trusted.publisherName],
      }
    : { provider: "generic", url: trusted.updateUrl });

  autoUpdater.on("checking-for-update", () =>
    recordDiagnostic("info", "updates.checking", {
      host: trusted.provider === "github"
        ? trusted.host
        : new URL(trusted.updateUrl).hostname,
    }),
  );
  autoUpdater.on("update-available", (info) =>
    recordDiagnostic("info", "updates.available", { version: info.version }),
  );
  autoUpdater.on("update-not-available", (info) =>
    recordDiagnostic("info", "updates.current", { version: info.version }),
  );
  autoUpdater.on("download-progress", (progress) =>
    recordDiagnostic("info", "updates.download_progress", {
      percent: Math.round(progress.percent),
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    recordDiagnostic("info", "updates.downloaded", { version: info.version }),
  );
  autoUpdater.on("error", (error) =>
    recordDiagnostic("error", "updates.failed", {
      name: error.name,
      message: error.message,
    }),
  );

  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    recordDiagnostic("error", "updates.check_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  });
}
