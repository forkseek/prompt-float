import { app } from "electron";
import path from "node:path";
import type { BudgetStatus } from "../../shared/types";
import type { UsageLimitSettings } from "./settingsStore";
import { recordDiagnostic } from "./diagnostics";
import { UsageRepository, type UsageReservation } from "./usageRepository";

export { estimateRequestTokens } from "./usageRepository";

let repository: UsageRepository | undefined;
let repositoryPath = "";

function getRepository(): UsageRepository {
  const nextPath = path.join(app.getPath("userData"), "usage.json");
  if (!repository || repositoryPath !== nextPath) {
    repositoryPath = nextPath;
    repository = new UsageRepository(nextPath, (message) =>
      recordDiagnostic("warning", "usage.repository_warning", {
        message,
      }),
    );
  }
  return repository;
}

export function reserveOptimizationUsage(
  settings: UsageLimitSettings,
  prompt: string,
  now = Date.now(),
): Promise<UsageReservation> {
  return getRepository().reserve(settings, prompt, now);
}

export function settleOptimizationUsage(
  reservation: UsageReservation,
  actualTokens?: number,
): Promise<boolean> {
  return getRepository().settle(reservation, actualTokens);
}

export function reserveRouteTestUsage(
  settings: UsageLimitSettings,
  now = Date.now(),
): Promise<UsageReservation> {
  return getRepository().reserve(settings, "模型路由健康探测", now, {
    maxOutputTokens: 1,
    systemOverheadTokens: 64,
  });
}

export function getBudgetStatus(
  settings: UsageLimitSettings,
  now = Date.now(),
): Promise<BudgetStatus> {
  return getRepository().status(settings, now);
}
