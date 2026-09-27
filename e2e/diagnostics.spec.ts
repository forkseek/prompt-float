import { expect, test, _electron as electron } from "@playwright/test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import packageMetadata from "../package.json";

test("exposes compatibility diagnostics without leaking saved credentials", async () => {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-diagnostics-e2e-"),
  );
  const secret = "sk-diagnostics-secret-123456789";
  const app = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      PROMPT_FLOAT_USER_DATA_DIR: userDataDirectory,
    },
  });

  try {
    const page = await app.firstWindow();
    await page.evaluate(
      async ({ credential }) =>
        window.promptFloat.saveProviderApiKey({
          provider: "openai",
          credential,
          confirmedApiHost: "api.openai.com",
        }),
      { credential: secret },
    );

    const report = await page.evaluate(() => window.promptFloat.getDiagnostics());
    expect(report.application.version).toBe(packageMetadata.version);
    expect(report.window?.alwaysOnTop).toBe(false);
    expect(report.displays.length).toBeGreaterThan(0);
    expect(report.activeRoute?.proxy).toBeTruthy();
    expect(JSON.stringify(report)).not.toContain(secret);

    await page.getByRole("button", { name: "打开设置" }).click();
    const settingsDialog = page.getByRole("dialog", { name: "模型路由设置" });
    await settingsDialog.locator("details.advanced-settings > summary").click();
    await expect(
      settingsDialog.getByRole("group", { name: "诊断与兼容性" }),
    ).toBeVisible();
    await expect(settingsDialog.getByText(`v${packageMetadata.version}`, { exact: true })).toBeVisible();

    const logsDirectory = await app.evaluate(({ app }) => app.getPath("logs"));
    await page.waitForTimeout(200);
    const diagnosticLog = await fs.readFile(
      path.join(logsDirectory, "prompt-float.log"),
      "utf8",
    );
    expect(diagnosticLog).not.toContain(secret);
  } finally {
    await app.close();
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }
});
