import { expect, test, _electron as electron } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let mockServer: Server;
let apiBaseUrl = "";
let alternateApiBaseUrl = "";
let lastCompletionPayload: Record<string, unknown> | undefined;
let lastCompletionPath = "";

test.beforeAll(async () => {
  mockServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ data: [{ id: "e2e-model" }, { id: "e2e-extra" }] }),
      );
      return;
    }
    if (request.method === "GET" && request.url === "/alt/v1/models") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ id: "e2e-backup" }, { id: "e2e-alt-extra" }],
          }),
        );
      }, 250);
      return;
    }
    if (
      request.method === "POST" &&
      (request.url === "/v1/chat/completions" ||
        request.url === "/alt/v1/chat/completions")
    ) {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        lastCompletionPayload = JSON.parse(body) as Record<string, unknown>;
        lastCompletionPath = request.url || "";
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const probe = lastCompletionPayload?.max_tokens === 1;
        setTimeout(() => {
          response.write(
            probe
              ? 'data: {"choices":[{"delta":{"content":"READY"}}]}\n\n'
              : 'data: {"choices":[{"delta":{"content":"优化后的"}}]}\n\n',
          );
        }, 120);
        setTimeout(() => {
          if (probe) {
            response.end("data: [DONE]\n\n");
            return;
          }
          response.write(
            'data: {"choices":[{"delta":{"content":"提示词"}}]}\n\n',
          );
          response.end("data: [DONE]\n\n");
        }, probe ? 180 : 260);
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    mockServer.listen(0, "127.0.0.1", resolve),
  );
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("No mock port");
  apiBaseUrl = `http://127.0.0.1:${address.port}/v1`;
  alternateApiBaseUrl = `http://127.0.0.1:${address.port}/alt/v1`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mockServer.close((error) => (error ? reject(error) : resolve())),
  );
});

test("switches a saved route's LLM, request path and provider model catalog without stale UI state", async () => {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-e2e-"),
  );
  let app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory,
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle("Prompt Float");
    const apiKeyDialog = page.getByRole("dialog", { name: "API Key 配置" });
    await expect(apiKeyDialog).toBeVisible();
    await expect(page.getByRole("dialog", { name: "模型路由设置" })).toHaveCount(
      0,
    );
    await expect(
      apiKeyDialog.getByRole("tab", { name: /OpenAI/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      apiKeyDialog.getByRole("button", {
        name: "打开 OpenAI API Key 申请网站",
      }),
    ).toBeVisible();
    await expect(apiKeyDialog.getByRole("tab")).toHaveCount(6);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(760, 560),
    );
    await expect(page.locator(".dialog-footer")).toBeVisible();
    expect(
      await page.locator(".dialog-footer").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight;
      }),
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(980, 720),
    );
    const firstRunApiKeyInput = apiKeyDialog.getByRole("textbox", {
      name: "API Key",
      exact: true,
    });
    await firstRunApiKeyInput.fill("first-run-secret");
    await apiKeyDialog
      .getByRole("checkbox", {
        name: "我确认 API Key 和提示词将发送到 api.openai.com",
      })
      .check();
    await apiKeyDialog
      .getByRole("button", { name: "保存此供应商" })
      .click();
    await expect(
      apiKeyDialog.getByText(/OpenAI 已安全保存并设为当前路由/),
    ).toBeVisible();
    await expect(firstRunApiKeyInput).toHaveValue("");
    await apiKeyDialog
      .locator(".api-key-setup-footer")
      .getByRole("button", { name: "完成并开始使用" })
      .click();
    await expect(apiKeyDialog).toBeHidden();
    const modeExplanation = page.locator("#mode-explanation");
    await expect(modeExplanation).toContainText("单次用户消息");
    await page.getByRole("tab", { name: "系统提示词" }).click();
    await expect(modeExplanation).toContainText("持续遵循的角色、职责和行为边界");
    await expect(modeExplanation).not.toContainText("单次用户消息");
    expect(await modeExplanation.evaluate((element) => {
      const swatch = document.createElement("span");
      swatch.style.color = "var(--text-soft)";
      element.appendChild(swatch);
      const matches = getComputedStyle(element).color === getComputedStyle(swatch).color;
      swatch.remove();
      return matches;
    })).toBe(true);
    await page.getByRole("tab", { name: "用户提示词" }).click();
    await expect(modeExplanation).toContainText("单次用户消息");
    await page.getByRole("button", { name: "打开设置" }).click();
    await expect(page.getByRole("dialog", { name: "模型路由设置" })).toBeVisible();
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop() ?? true,
      ),
    ).toBe(false);
    await expect(page.getByText("窗口始终置顶", { exact: true })).toHaveCount(0);
    expect(
      await page.locator(".title-bar").evaluate((element) =>
        getComputedStyle(element).getPropertyValue("-webkit-app-region"),
      ),
    ).toBe("drag");

    await page.getByLabel("供应商", { exact: true }).selectOption("deepseek");
    await expect(page.getByLabel("供应商模型")).toContainText(
      "deepseek-v4-flash",
    );
    await page
      .getByLabel("供应商", { exact: true })
      .selectOption("openai-compatible");
    await page.getByLabel("API 地址").fill(apiBaseUrl);
    await page.getByLabel("模型名称").fill("e2e-model");
    await page.getByLabel("API Key").fill("e2e-secret");
    await page.getByRole("button", { name: "刷新模型" }).click();
    await expect(page.getByText(/已从 自定义 OpenAI 兼容接口 获取 2 个可用模型/)).toBeVisible();
    await page.getByLabel("供应商模型").selectOption("e2e-model");

    await page.getByRole("button", { name: "测试路由" }).click();
    await expect(page.getByText(/总回路/)).toBeVisible();
    await expect(
      page.getByText(/已向 .*发送最小模型探测并收到响应/),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存并启用" }).click();
    await expect(page.getByRole("dialog", { name: "模型路由设置" })).toBeHidden();
    const themeButton = page.getByRole("button", {
      name: /选择界面主题/,
    });
    await themeButton.click();
    await page.getByRole("menuitemradio", { name: "浅色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(themeButton).toHaveAttribute("aria-label", /当前浅色/);

    const optimizeButton = page.getByRole("button", { name: /优化提示词/ });
    await expect(optimizeButton).toHaveAttribute("data-jelly", "true");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await optimizeButton.evaluate((element) =>
        getComputedStyle(element)
          .transitionDuration.split(",")
          .every((duration) => Number.parseFloat(duration) <= 0.001),
      ),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop() ?? true,
      ),
    ).toBe(false);

    await page.getByRole("button", { name: "最小化窗口" }).click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]?.isMinimized() ?? false,
        ),
      )
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.restore(),
    );
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]?.isMinimized() ?? true,
        ),
      )
      .toBe(false);

    const routeSwitcher = page.getByRole("button", {
      name: "打开 API 请求链路快速切换",
    });
    await routeSwitcher.click();
    const routePopover = page.getByRole("dialog", {
      name: "API 请求链路快速切换",
    });
    const primaryRouteCard = routePopover.locator(".route-card.is-active");
    const primaryRouteId = await primaryRouteCard.getAttribute("data-route-id");
    expect(primaryRouteId).toBeTruthy();
    await expect(primaryRouteCard).toContainText("e2e-model");
    await expect(primaryRouteCard).toContainText("当前使用");
    await expect(primaryRouteCard).not.toContainText("e2e-secret");
    await page.keyboard.press("Escape");
    await expect(routePopover).toBeHidden();
    await expect(routeSwitcher).toContainText("e2e-model");

    const promptInput = page.getByPlaceholder("例如：帮我写一份项目计划……");
    const resultInput = page.locator(".result-card textarea");
    await promptInput.fill("帮我写计划");
    await page.getByRole("button", { name: /优化提示词/ }).click();
    await expect(promptInput).toBeDisabled();
    await expect(resultInput).toBeDisabled();
    await expect(page.getByRole("tab", { name: "系统提示词" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "历史", exact: true })).toBeDisabled();
    await expect(page.getByText("已锁定快照", { exact: true })).toBeVisible();
    await expect(page.getByText("正在整理提示词", { exact: true })).toBeVisible();
    await expect(resultInput).toHaveValue("优化后的提示词");
    await expect(promptInput).toBeEnabled();
    await expect(page.getByText("已锁定快照", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "历史", exact: true }).click();
    const operationHistory = page.getByRole("region", {
      name: "操作面板历史记录",
    });
    await expect(operationHistory).toBeVisible();
    await expect(operationHistory.locator(".history-panel-item")).toHaveCount(1);
    await operationHistory.getByRole("searchbox", { name: "查找历史记录" })
      .fill("没有的关键词");
    await expect(operationHistory.getByText("没有匹配的记录，请换个关键词。"))
      .toBeVisible();
    await operationHistory.getByRole("searchbox", { name: "查找历史记录" })
      .fill("帮我写计划");
    await expect(operationHistory.locator(".history-panel-item")).toHaveCount(1);
    await operationHistory.locator(".history-panel-item").click();
    const historyButton = page.getByRole("button", { name: "打开历史记录" });
    const historyDialog = page.getByRole("dialog", { name: "历史记录" });
    await expect(historyDialog).toBeVisible();
    await expect(historyDialog.locator(".history-item")).toHaveCount(1);
    await expect(historyDialog.locator(".history-comparison pre").first())
      .toHaveText("帮我写计划");
    await expect(historyDialog.locator(".history-comparison pre").last())
      .toHaveText("优化后的提示词");
    await historyDialog.getByRole("button", { name: "差异" }).click();
    await expect(historyDialog.getByLabel("优化差异")).toContainText("帮我写计划");
    await historyDialog.getByRole("button", { name: "原文 / 结果" }).click();
    await historyDialog.getByRole("searchbox", { name: "查找历史记录" })
      .fill("不存在的关键词");
    await expect(historyDialog.getByText("没有匹配的记录，请尝试其他关键词。"))
      .toBeVisible();
    await historyDialog.getByRole("searchbox", { name: "查找历史记录" })
      .fill("帮我写计划");
    await expect(historyDialog.locator(".history-item")).toHaveCount(1);
    await historyDialog.getByRole("button", { name: "关闭历史记录" }).click();
    await historyButton.click();
    await expect(historyDialog).toBeVisible();
    await historyDialog.getByRole("button", { name: "关闭历史记录" }).click();
    await page.getByRole("button", { name: "结果", exact: true }).click();
    await expect(resultInput).toHaveValue("优化后的提示词");
    expect(await fs.readFile(path.join(userDataDirectory, "history.json"), "utf8"))
      .not.toContain("帮我写计划");

    expect(lastCompletionPayload?.max_tokens).toBe(4_096);
    expect(lastCompletionPayload?.stream).toBe(true);

    await page.getByRole("button", { name: "打开设置" }).click();
    await page.getByRole("button", { name: "打开快速配置" }).click();
    await expect(page.getByRole("dialog", { name: "API Key 配置" })).toBeVisible();
    await page.getByRole("button", { name: "返回设置" }).click();
    await expect(
      page.getByRole("dialog", { name: "模型路由设置" }),
    ).toBeVisible();
    const savedCredentialInput = page.getByLabel("API Key");
    await expect(savedCredentialInput).toHaveValue("");
    await expect(
      page.getByText(
        "API Key 已安全保存。为防止泄露，重新打开设置时密码框始终留空。",
      ),
    ).toBeVisible();
    await page.getByLabel("API 地址").fill(alternateApiBaseUrl);
    await expect(
      page.getByText(/原路由凭据不会转移，请重新输入/),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存并启用" }).click();
    await expect(
      page.getByText(
        "供应商、运行模式或 API 地址已改变，请重新填写 API Key 后再保存",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "模型路由设置" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();

    await promptInput.fill("请求完成后编辑的文本");
    await page.getByRole("button", { name: "差异" }).click();
    await expect(page.locator(".diff-view")).toContainText("帮我写计划");
    await page.getByRole("button", { name: "结果", exact: true }).click();
    await promptInput.fill("帮我写计划");
    await page.getByRole("button", { name: "应用结果" }).click();
    await expect(promptInput).toHaveValue("优化后的提示词");
    await page.getByRole("button", { name: "撤销应用" }).click();
    await expect(promptInput).toHaveValue("帮我写计划");

    await page.getByRole("button", { name: "打开设置" }).click();
    await page.getByRole("button", { name: "新建路由" }).click();
    await page.getByLabel("路由名称").fill("备用本地路由");
    await page
      .getByLabel("供应商", { exact: true })
      .selectOption("openai-compatible");
    await page.getByLabel("API 地址").fill(alternateApiBaseUrl);
    await page.getByLabel("模型名称").fill("e2e-backup");
    await page.getByLabel("API Key").fill("backup-secret");
    await page.getByRole("button", { name: "保存并启用" }).click();
    await expect(page.getByRole("dialog", { name: "模型路由设置" })).toBeHidden();
    await expect(routeSwitcher).toContainText("备用本地路由");
    await expect(routeSwitcher).toContainText("e2e-backup");

    await routeSwitcher.click();
    await expect(routePopover.locator(".route-card")).toHaveCount(2);
    await expect(routePopover.locator(".route-card.is-active")).toContainText(
      "备用本地路由",
    );
    await expect(
      routePopover.locator(`[data-route-id="${primaryRouteId}"]`),
    ).toContainText("e2e-model");
    await routePopover
      .locator(`[data-route-id="${primaryRouteId}"]`)
      .getByRole("button", { name: /编辑链路/ })
      .click();

    const savedRoutePicker = page.getByLabel("已保存路由");
    await expect(savedRoutePicker).toHaveValue(primaryRouteId!);
    await expect(page.getByLabel("供应商模型")).toHaveValue("e2e-model");
    await expect(page.getByLabel("供应商模型")).toContainText("e2e-extra");
    await page.waitForTimeout(350);
    await expect(page.getByLabel("供应商模型")).not.toContainText("e2e-alt-extra");
    await expect(page.getByLabel("当前路由映射")).toContainText("e2e-model");
    await expect(page.getByLabel("当前路由映射")).toContainText(apiBaseUrl);
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog", { name: "模型路由设置" })).toBeHidden();

    await routeSwitcher.click();
    await routePopover
      .locator(`[data-route-id="${primaryRouteId}"]`)
      .getByRole("button", { name: /切换到链路/ })
      .click();
    await expect(routePopover).toBeHidden();
    await expect(routeSwitcher).toContainText("e2e-model");
    await expect(routeSwitcher).toContainText("自定义 OpenAI 兼容接口");
    await expect(routeSwitcher).toHaveAttribute(
      "title",
      new RegExp(`当前 LLM：e2e-model.*请求路径：${apiBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "s"),
    );
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop() ?? true,
      ),
    ).toBe(false);

    await promptInput.fill("确认切换后的请求路径");
    await page.getByRole("button", { name: /优化提示词/ }).click();
    await expect(resultInput).toHaveValue("优化后的提示词");
    await expect(historyButton).toBeEnabled();
    expect(lastCompletionPayload?.model).toBe("e2e-model");
    expect(lastCompletionPath).toBe("/v1/chat/completions");

    await app.close();
    app = await electron.launch({
      args: [path.resolve(".")],
      env: {
        ...process.env,
        PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory,
      },
    });
    const restartedPage = await app.firstWindow();
    await expect(restartedPage).toHaveTitle("Prompt Float");
    await restartedPage.getByRole("button", { name: "历史", exact: true }).click();
    const restartedOperationHistory = restartedPage.getByRole("region", {
      name: "操作面板历史记录",
    });
    await expect(restartedOperationHistory.locator(".history-panel-item"))
      .toHaveCount(2);
    await restartedOperationHistory.locator(".history-panel-item").last().click();
    const restartedHistory = restartedPage.getByRole("dialog", { name: "历史记录" });
    await expect(restartedHistory.locator(".history-comparison pre").first())
      .toHaveText("帮我写计划");
    await restartedHistory.getByRole("button", { name: "关闭历史记录" }).click();
    await restartedOperationHistory.locator(".history-panel-item").first().click();
    await expect(restartedHistory.locator(".history-item")).toHaveCount(2);
    await expect(restartedHistory.locator(".history-comparison pre").first())
      .toHaveText("确认切换后的请求路径");
    await restartedHistory.getByRole("button", { name: "关闭历史记录" }).click();
    await restartedPage.getByRole("button", { name: "结果", exact: true }).click();
    await expect(
      restartedPage.getByRole("dialog", { name: "API Key 配置" }),
    ).toHaveCount(0);
    await expect(restartedPage.locator("html")).toHaveAttribute(
      "data-theme",
      "light",
    );
    const restartedRouteSwitcher = restartedPage.getByRole("button", {
      name: "打开 API 请求链路快速切换",
    });
    await expect(restartedRouteSwitcher).toContainText("e2e-model");
    await restartedRouteSwitcher.click();
    await expect(
      restartedPage
        .getByRole("dialog", { name: "API 请求链路快速切换" })
        .locator(`[data-route-id="${primaryRouteId}"]`),
    ).toHaveClass(/is-active/);
    await restartedPage.keyboard.press("Escape");
    const restartedDialog = restartedPage.getByRole("dialog", {
      name: "模型路由设置",
    });
    if (!(await restartedDialog.isVisible())) {
      await restartedPage.getByRole("button", { name: "打开设置" }).click();
    }
    await expect(
      restartedPage.getByText(
        "API Key 已安全保存。为防止泄露，重新打开设置时密码框始终留空。",
      ),
    ).toBeVisible();
    await expect(restartedPage.getByLabel("API Key")).toHaveValue("");
    await restartedPage.getByRole("button", { name: "取消" }).click();

    const restartedPromptInput = restartedPage.getByPlaceholder(
      "例如：帮我写一份项目计划……",
    );
    const restartedResultInput = restartedPage.locator(".result-card textarea");
    await fs.writeFile(path.join(userDataDirectory, "history.json"), "{broken", "utf8");
    await fs.writeFile(path.join(userDataDirectory, "history.json.bak"), "{broken", "utf8");
    await restartedPromptInput.fill("确认重启后仍能使用已保存的 Key");
    await restartedPage.getByRole("button", { name: /优化提示词/ }).click();
    await expect(restartedResultInput).toHaveValue("优化后的提示词");
    await expect(restartedPage.getByText(/历史记录保存失败/)).toBeVisible();
    await expect(restartedResultInput).toHaveValue("优化后的提示词");
    await restartedPage.getByRole("button", { name: "历史", exact: true }).click();
    await expect(restartedPage.getByRole("region", {
      name: "操作面板历史记录",
    }).getByText("历史记录读取失败，原有数据未被清空。"))
      .toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }
});

test("shows an empty local history before the first successful optimization", async () => {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-history-empty-"),
  );
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory },
  });
  try {
    const page = await app.firstWindow();
    await page.locator(".api-key-setup-footer")
      .getByRole("button", { name: "稍后设置" }).click();
    await page.getByRole("button", { name: "历史", exact: true }).click();
    const historyPanel = page.getByRole("region", {
      name: "操作面板历史记录",
    });
    await expect(historyPanel.getByText("还没有历史记录。完成一次优化后会自动保存。"))
      .toBeVisible();
    await expect(historyPanel.locator(".history-panel-item")).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(760, 560),
    );
    expect(
      await page.evaluate(() => {
        const panel = document.querySelector(".history-panel")?.getBoundingClientRect();
        const footer = document.querySelector(".action-bar")?.getBoundingClientRect();
        return Boolean(panel && footer && panel.bottom <= footer.top &&
          footer.bottom <= window.innerHeight);
      }),
    ).toBe(true);
    await page.getByRole("button", { name: "打开历史记录" }).click();
    const dialog = page.getByRole("dialog", { name: "历史记录" });
    await expect(dialog.getByText("还没有历史记录。完成一次提示词优化后会自动保存。"))
      .toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }
});

test("opens settings for an unreadable saved key and restores use after replacement", async () => {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-key-recovery-"),
  );
  let app = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory },
  });
  try {
    const page = await app.firstWindow();
    const onboarding = page.getByRole("dialog", { name: "API Key 配置" });
    await onboarding.getByRole("textbox", { name: "API Key", exact: true })
      .fill("old-e2e-key");
    await onboarding.getByRole("checkbox", {
      name: "我确认 API Key 和提示词将发送到 api.openai.com",
    }).check();
    await onboarding.getByRole("button", { name: "保存此供应商" }).click();
    await expect(onboarding.getByText(/OpenAI 已安全保存并设为当前路由/))
      .toBeVisible();
    await app.close();

    const settingsFile = path.join(userDataDirectory, "settings.json");
    const saved = JSON.parse(await fs.readFile(settingsFile, "utf8")) as {
      routes: Array<{ encryptedCredential: string }>;
    };
    const priorCiphertext = saved.routes[0]!.encryptedCredential;
    saved.routes[0]!.encryptedCredential = Buffer.from("not-encrypted", "utf8")
      .toString("base64");
    await fs.writeFile(settingsFile, JSON.stringify(saved), "utf8");
    const unreadableFile = await fs.readFile(settingsFile, "utf8");

    app = await electron.launch({
      args: [path.resolve(".")],
      env: { ...process.env, PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory },
    });
    const restartedPage = await app.firstWindow();
    const settingsDialog = restartedPage.getByRole("dialog", {
      name: "模型路由设置",
    });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByText(/已保存的 API Key 无法解密。请在此输入新凭据/))
      .toBeVisible();
    expect(await fs.readFile(settingsFile, "utf8")).toBe(unreadableFile);

    await settingsDialog.getByRole("button", { name: "测试路由" }).click();
    await expect(settingsDialog.getByText(/旧凭据无法解密；请在上方输入新 Key/))
      .toBeVisible();
    expect(await fs.readFile(settingsFile, "utf8")).toBe(unreadableFile);

    await settingsDialog.getByRole("button", { name: "打开快速配置" }).click();
    const quickSetup = restartedPage.getByRole("dialog", { name: "API Key 配置" });
    await expect(quickSetup.getByText(/旧 Key 已无法解密。填入新 Key、勾选下方域名确认/))
      .toBeVisible();
    await quickSetup.getByRole("button", { name: "返回设置" }).click();
    await expect(settingsDialog).toBeVisible();

    await settingsDialog.getByRole("textbox", { name: "API Key", exact: true })
      .fill("replacement-e2e-key");
    await settingsDialog.getByRole("button", { name: "保存并启用" }).click();
    await expect(settingsDialog).toBeHidden();
    const repaired = JSON.parse(await fs.readFile(settingsFile, "utf8")) as {
      routes: Array<{ encryptedCredential: string }>;
    };
    expect(repaired.routes[0]!.encryptedCredential).not.toBe(priorCiphertext);
    expect(repaired.routes[0]!.encryptedCredential).not.toBe(saved.routes[0]!.encryptedCredential);
    expect(JSON.stringify(repaired)).not.toContain("replacement-e2e-key");
    await expect(restartedPage.getByRole("alert").filter({
      hasText: "当前路由保存的凭据无法解密",
    })).toHaveCount(0);

    await app.close();
    app = await electron.launch({
      args: [path.resolve(".")],
      env: { ...process.env, PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory },
    });
    const recoveredPage = await app.firstWindow();
    await expect(recoveredPage.getByRole("dialog", { name: "模型路由设置" }))
      .toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }
});
