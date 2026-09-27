/* global window -- Playwright page.evaluate callbacks run inside the application. */
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Arch, build, Platform } = require("electron-builder");
const {
  launchPackagedApplication,
  terminatePackagedApplication,
} = require("./smoke-packaged.cjs");
const { version } = require("../package.json");

const BASELINE_VERSION = "0.6.1";
const TEST_APP_ID = "local.promptfloat.upgrade-test";
const TEST_PRODUCT_NAME = "Prompt Float Upgrade Test";

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runExecutable(executable, args, label) {
  const child = spawn(executable, args, {
    stdio: "ignore",
    windowsHide: true,
  });
  const exitCode = await withTimeout(
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }),
    120_000,
    label,
  );
  if (exitCode !== 0) throw new Error(`${label} exited with ${exitCode}`);
}

async function waitForFile(filePath, label) {
  await withTimeout((async () => {
    while (true) {
      try {
        await fs.access(filePath);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  })(), 30_000, label);
}

async function buildInstaller(testVersion, outputDirectory) {
  const artifacts = await build({
    targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
    publish: "never",
    config: {
      appId: TEST_APP_ID,
      productName: TEST_PRODUCT_NAME,
      directories: { output: outputDirectory },
      extraMetadata: { version: testVersion },
      nsis: {
        oneClick: true,
        perMachine: false,
        allowToChangeInstallationDirectory: false,
        createDesktopShortcut: false,
        createStartMenuShortcut: false,
        runAfterFinish: false,
        artifactName: "Upgrade-Test-Setup-${version}-${arch}.${ext}",
      },
    },
  });
  const installer = artifacts.find((artifact) => artifact.endsWith(".exe"));
  if (!installer) throw new Error(`No NSIS installer for ${testVersion}`);
  return path.resolve(installer);
}

async function settingsHash(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function closeApplication(instance) {
  const exited = instance.child.exitCode === null
    ? new Promise((resolve) => instance.child.once("exit", resolve))
    : Promise.resolve(instance.child.exitCode);
  // Closing the window destroys the CDP target before evaluate may resolve.
  const closing = instance.page.evaluate(() => window.promptFloat.closeWindow())
    .catch(() => undefined);
  await withTimeout(exited, 15_000, "Application close");
  await closing;
  await instance.browser.close().catch(() => undefined);
}

async function removeTemporaryDirectory(directory) {
  const root = await fs.realpath(os.tmpdir());
  const target = await fs.realpath(directory);
  const relative = path.relative(root, target);
  if (
    !relative.startsWith("prompt-float-upgrade-") ||
    relative.includes(path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Refusing to remove an unexpected test directory");
  }
  await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function main() {
  if (
    process.platform !== "win32" ||
    process.env.CI !== "true" ||
    process.env.PROMPT_FLOAT_ENABLE_INSTALL_UPGRADE_TEST !== "1"
  ) {
    throw new Error("Installer upgrade test runs only in an explicitly enabled Windows CI job");
  }
  const root = path.resolve(__dirname, "..");
  process.env.ELECTRON_BUILDER_CACHE = path.join(root, ".electron-builder-cache");
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-float-upgrade-"));
  const installDirectory = path.join(temporaryDirectory, "application");
  const userDataDirectory = path.join(temporaryDirectory, "user-data");
  const installedExe = path.join(installDirectory, `${TEST_PRODUCT_NAME}.exe`);
  const environment = {
    ...process.env,
    PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory,
  };
  let instance;
  try {
    const baselineInstaller = await buildInstaller(
      BASELINE_VERSION,
      path.join("release", "install-upgrade-test", "baseline"),
    );
    const candidateInstaller = await buildInstaller(
      version,
      path.join("release", "install-upgrade-test", "candidate"),
    );
    await runExecutable(baselineInstaller, ["/S", `/D=${installDirectory}`], "Baseline install");
    await waitForFile(installedExe, "Baseline executable");
    instance = await launchPackagedApplication(installedExe, environment);
    const baselineVersion = await instance.page.evaluate(async () =>
      (await window.promptFloat.getDiagnostics()).application.version);
    if (baselineVersion !== BASELINE_VERSION) {
      throw new Error(`Baseline installed version is ${baselineVersion}`);
    }
    await instance.page.evaluate(() => window.promptFloat.saveProviderApiKey({
      provider: "openai",
      credential: "sk-upgrade-test-fixture-not-real",
      confirmedApiHost: "api.openai.com",
    }));
    await closeApplication(instance);
    instance = undefined;
    const settingsPath = path.join(userDataDirectory, "settings.json");
    const beforeHash = await settingsHash(settingsPath);

    await runExecutable(candidateInstaller, ["/S", `/D=${installDirectory}`], "Candidate upgrade");
    await waitForFile(installedExe, "Upgraded executable");
    if (await settingsHash(settingsPath) !== beforeHash) {
      throw new Error("Installer changed the user's settings file");
    }
    instance = await launchPackagedApplication(installedExe, environment);
    const state = await instance.page.evaluate(async () => ({
      version: (await window.promptFloat.getDiagnostics()).application.version,
      settings: await window.promptFloat.getSettings(),
    }));
    if (
      state.version !== version ||
      !state.settings.apiKeyOnboardingCompleted ||
      !state.settings.routes.some((route) => route.provider === "openai" && route.hasCredential)
    ) {
      throw new Error("Upgrade did not preserve the encrypted provider settings");
    }
    await closeApplication(instance);
    instance = undefined;
    console.log(`NSIS upgrade ${BASELINE_VERSION} -> ${version} preserved encrypted settings`);
  } finally {
    await terminatePackagedApplication(instance);
    const entries = await fs.readdir(installDirectory).catch(() => []);
    const uninstaller = entries.find((name) => /^Uninstall.*\.exe$/i.test(name));
    if (uninstaller) {
      await runExecutable(path.join(installDirectory, uninstaller), ["/S"], "Test app uninstall")
        .catch((error) => console.warn("Test uninstall failed:", error.message));
    }
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Upgrade test failed");
  process.exitCode = 1;
});
