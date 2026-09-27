/* global window -- Playwright's page.evaluate callback runs in the renderer. */
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { version } = require("../package.json");
const {
  assertElectronFuses,
} = require("./apply-electron-fuses.cjs");

async function startUntrustedRendererServer() {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Untrusted Renderer</title>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start untrusted renderer test server");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    requestCount: () => requestCount,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function startMaliciousUpdateProbe() {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to start update probe");
  }
  return {
    url: `https://127.0.0.1:${address.port}/updates/`,
    connections: () => connections,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    ),
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function logStep(message) {
  console.log(`[package-e2e] ${message}`);
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to reserve a renderer debugging port");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function waitForProcessExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return withTimeout(
    new Promise((resolve) => child.once("exit", resolve)),
    timeoutMs,
    "Packaged process exit",
  );
}

async function forceKillProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    await withTimeout(
      new Promise((resolve) => killer.once("exit", resolve)),
      5_000,
      "Packaged process tree termination",
    ).catch(() => undefined);
  } else {
    child.kill("SIGKILL");
  }
  await waitForProcessExit(child, 5_000).catch(() => undefined);
}

async function launchPackagedApplication(executablePath, environment) {
  const debuggingPort = await reserveLoopbackPort();
  const output = [];
  const child = spawn(
    executablePath,
    [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=" + debuggingPort,
    ],
    {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  let browser;
  try {
    browser = await withTimeout(
      (async () => {
        while (child.exitCode === null) {
          try {
            return await chromium.connectOverCDP(
              "http://127.0.0.1:" + debuggingPort,
              { timeout: 500 },
            );
          } catch {
            await delay(200);
          }
        }
        throw new Error("Packaged process exited before CDP was available");
      })(),
      20_000,
      "Packaged Chromium CDP connection",
    );

    const page = await withTimeout(
      (async () => {
        while (child.exitCode === null) {
          for (const context of browser.contexts()) {
            const pages = context.pages();
            const trustedPage = pages.find((item) =>
              item.url().startsWith("prompt-float:"),
            );
            if (trustedPage) return trustedPage;
            const remotePage = pages.find((item) =>
              /^https?:\/\//i.test(item.url()),
            );
            if (remotePage) {
              throw new Error(
                "Packaged application loaded a remote renderer: " +
                  remotePage.url(),
              );
            }
          }
          await delay(100);
        }
        throw new Error("Packaged process exited before a page was created");
      })(),
      20_000,
      "Packaged renderer page",
    );
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    return { browser, child, output, page };
  } catch (error) {
    await forceKillProcessTree(child);
    const details = output.join("").trim();
    throw new Error(
      (error instanceof Error ? error.message : "Package launch failed") +
        (details ? "\n" + details : ""),
      { cause: error },
    );
  }
}

async function terminatePackagedApplication(instance) {
  if (!instance) return;
  await instance.browser.close().catch(() => undefined);
  await forceKillProcessTree(instance.child);
}

async function closePackagedApplicationThroughUi(instance) {
  const exit = waitForProcessExit(instance.child);
  await instance.page
    .getByRole("button", { name: "关闭窗口" })
    .click();
  await exit;
  await instance.browser.close().catch(() => undefined);
}

async function assertSingleInstance(executablePath, environment, firstInstance) {
  const second = spawn(executablePath, [], {
    env: environment,
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    const exitCode = await waitForProcessExit(second, 10_000);
    if (exitCode !== 0) {
      throw new Error(`Second application instance exited with ${exitCode}`);
    }
    if (firstInstance.child.exitCode !== null) {
      throw new Error("First application instance exited unexpectedly");
    }
    await firstInstance.page
      .getByRole("dialog", { name: "API Key 配置" })
      .waitFor({ state: "visible", timeout: 10_000 });
  } finally {
    await forceKillProcessTree(second);
  }
}

async function assertProductionRendererSecurity(page, untrustedRenderer) {
  const documentResponse = await page.reload({
    waitUntil: "domcontentloaded",
    timeout: 10_000,
  });
  const cspHeader = documentResponse
    ? await documentResponse.headerValue("content-security-policy")
    : null;
  if (
    !cspHeader ||
    !cspHeader.includes("default-src 'none'") ||
    !cspHeader.includes("connect-src 'none'") ||
    !cspHeader.includes("frame-ancestors 'none'")
  ) {
    throw new Error(
      "Packaged renderer CSP response header is not strict: " +
        (cspHeader || "missing"),
    );
  }

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  if (
    !csp ||
    !csp.includes("default-src 'none'") ||
    !csp.includes("connect-src 'none'") ||
    !csp.includes("style-src 'self'") ||
    csp.includes("'unsafe-inline'") ||
    csp.includes("127.0.0.1")
  ) {
    throw new Error(`Packaged renderer CSP is not strict: ${csp || "missing"}`);
  }

  const fetchResult = await withTimeout(
    page.evaluate(async (url) => {
      try {
        await fetch(`${url}renderer-network-probe`);
        return "allowed";
      } catch {
        return "blocked";
      }
    }, untrustedRenderer.url),
    5_000,
    "Renderer network probe",
  );
  if (fetchResult !== "blocked") {
    throw new Error("Packaged renderer unexpectedly completed a network request");
  }
  if (untrustedRenderer.requestCount() !== 0) {
    throw new Error("Packaged renderer network request reached the test server");
  }
}

async function main() {
  const releaseDirectory = path.resolve(
    process.cwd(),
    process.env.PROMPT_FLOAT_RELEASE_DIR || path.join("release", `v${version}`),
  );
  const executablePath = path.resolve(
    releaseDirectory,
    "win-unpacked",
    "Prompt Float.exe",
  );
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-package-smoke-"),
  );
  const untrustedRenderer = await startUntrustedRendererServer();
  const maliciousUpdate = await startMaliciousUpdateProbe();
  const nodeOptionsSentinel = path.join(
    userDataDirectory,
    "node-options-executed.txt",
  );
  const nodeOptionsProbe = path.join(userDataDirectory, "node-options-probe.cjs");
  await fs.writeFile(
    nodeOptionsProbe,
    `require("node:fs").writeFileSync(${JSON.stringify(
      nodeOptionsSentinel,
    )}, "executed");\n`,
    "utf8",
  );
  const hostileEnvironment = {
    ...process.env,
    PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory,
    VITE_DEV_SERVER_URL: untrustedRenderer.url,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: `--require=${nodeOptionsProbe}`,
    NODE_EXTRA_CA_CERTS: path.join(userDataDirectory, "attacker-ca.pem"),
    PROMPT_FLOAT_UPDATE_URL: maliciousUpdate.url,
  };
  let instance;
  try {
    logStep("verifying Electron Fuses");
    await assertElectronFuses(executablePath);
    logStep("Electron Fuses verified");
    logStep("launching package with hostile environment");
    instance = await launchPackagedApplication(
      executablePath,
      hostileEnvironment,
    );
    const page = instance.page;
    logStep("first packaged window ready");
    if (!page.url().startsWith("prompt-float://app/")) {
      throw new Error("Packaged application loaded an untrusted renderer");
    }
    if (untrustedRenderer.requestCount() !== 0) {
      throw new Error("Packaged application contacted an untrusted renderer");
    }
    if (await pathExists(nodeOptionsSentinel)) {
      throw new Error("Packaged application executed malicious NODE_OPTIONS");
    }
    await assertSingleInstance(executablePath, hostileEnvironment, instance);
    logStep("second launch reused the existing instance");
    await delay(500);
    if (maliciousUpdate.connections() !== 0) {
      throw new Error("Packaged application contacted an environment-selected update source");
    }
    logStep("malicious update source ignored");
    if ((await page.title()) !== "Prompt Float") {
      throw new Error("Packaged window title did not load");
    }
    await assertProductionRendererSecurity(page, untrustedRenderer);
    logStep("production CSP and renderer network block verified");
    const apiKeyDialog = page.getByRole("dialog", { name: "API Key 配置" });
    await apiKeyDialog.waitFor({ state: "visible", timeout: 10_000 });
    if (
      (await page.getByRole("dialog", { name: "模型路由设置" }).count()) !== 0
    ) {
      throw new Error("A second dialog opened before first-launch API Key setup");
    }
    if ((await apiKeyDialog.getByRole("tab").count()) !== 6) {
      throw new Error("Packaged API Key provider catalog did not load");
    }
    await apiKeyDialog
      .getByRole("button", { name: "打开 OpenAI API Key 申请网站" })
      .waitFor({ state: "visible", timeout: 10_000 });
    await apiKeyDialog
      .locator(".api-key-setup-footer")
      .getByRole("button", { name: "稍后设置", exact: true })
      .click();
    logStep("first-launch dialog verified");
    await page.getByRole("button", { name: "历史", exact: true }).click();
    const historyPanel = page.getByRole("region", {
      name: "操作面板历史记录",
    });
    await historyPanel.waitFor({ state: "visible", timeout: 10_000 });
    await historyPanel
      .getByText("还没有历史记录。完成一次优化后会自动保存。")
      .waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "结果", exact: true }).click();
    logStep("packaged history panel verified");
    await page.getByRole("button", { name: "打开设置" }).click();
    const routeDialog = page.getByRole("dialog", { name: "模型路由设置" });
    await routeDialog.waitFor({ state: "visible", timeout: 10_000 });
    const provider = page.getByLabel("供应商", { exact: true });
    if ((await provider.inputValue()) !== "openai") {
      throw new Error("Packaged model route settings did not load");
    }
    await page
      .getByText(
        "尚未保存 API Key；直连路由必须填写后才能保存并启用。",
      )
      .waitFor({ state: "visible", timeout: 10_000 });
    if ((await page.getByText("窗口始终置顶", { exact: true }).count()) !== 0) {
      throw new Error("Retired topmost setting is still visible");
    }
    const routeBinding = page.getByLabel("当前路由映射");
    await routeBinding.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await routeBinding.textContent()).includes("gpt-4.1-mini")) {
      throw new Error("Packaged route-to-LLM binding did not load");
    }
    const bridgeType = await page.evaluate(() => typeof window.promptFloat);
    if (bridgeType !== "object") {
      throw new Error("Packaged preload bridge did not load");
    }
    logStep("settings and preload bridge verified");

    await page.getByRole("button", { name: "取消" }).click();
    const routeSwitcher = page.getByRole("button", {
      name: "打开 API 请求链路快速切换",
    });
    await routeSwitcher.click();
    const routePopover = page.getByRole("dialog", {
      name: "API 请求链路快速切换",
    });
    await routePopover.waitFor({ state: "visible", timeout: 10_000 });
    const activeRouteCard = routePopover.locator(".route-card.is-active");
    if (!(await activeRouteCard.textContent()).includes("gpt-4.1-mini")) {
      throw new Error("Packaged quick switch did not highlight the active route");
    }
    await activeRouteCard.getByRole("button", { name: /当前链路/ }).click();
    await routePopover.waitFor({ state: "hidden", timeout: 10_000 });
    logStep("route switcher verified");

    await page.getByRole("button", { name: /选择界面主题/ }).click();
    await page.getByRole("menuitemradio", { name: "浅色" }).click();
    await page.locator('html[data-theme="light"]').waitFor({
      state: "attached",
      timeout: 10_000,
    });
    logStep("theme persistence prepared");

    await closePackagedApplicationThroughUi(instance);
    instance = undefined;
    logStep("first package instance closed");
    instance = await launchPackagedApplication(
      executablePath,
      hostileEnvironment,
    );
    const restartedPage = instance.page;
    logStep("restarted packaged window ready");
    if (!restartedPage.url().startsWith("prompt-float://app/")) {
      throw new Error("Restarted package loaded an untrusted renderer");
    }
    if (untrustedRenderer.requestCount() !== 0) {
      throw new Error("Restarted package contacted an untrusted renderer");
    }
    if (await pathExists(nodeOptionsSentinel)) {
      throw new Error("Restarted package executed malicious NODE_OPTIONS");
    }
    if (maliciousUpdate.connections() !== 0) {
      throw new Error("Restarted package contacted an environment-selected update source");
    }
    await assertProductionRendererSecurity(restartedPage, untrustedRenderer);
    logStep("restart security checks verified");
    await restartedPage.locator('html[data-theme="light"]').waitFor({
      state: "attached",
      timeout: 10_000,
    });
    await restartedPage
      .getByRole("dialog", { name: "API Key 配置" })
      .waitFor({ state: "visible", timeout: 10_000 });
    console.log("Packaged application smoke test passed");
  } finally {
    await terminatePackagedApplication(instance);
    await untrustedRenderer.close();
    await maliciousUpdate.close();
    await fs
      .rm(userDataDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      })
      .catch((error) =>
        console.warn(
          "Temporary package test data could not be removed:",
          error instanceof Error ? error.message : error,
        ),
      );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Package smoke failed");
    process.exitCode = 1;
  });
}

module.exports = {
  launchPackagedApplication,
  terminatePackagedApplication,
};
