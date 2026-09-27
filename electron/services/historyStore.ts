import { app, safeStorage } from "electron";
import path from "node:path";
import type { OptimizeRequest, PromptHistoryRecord } from "../../shared/types";
import { HistoryRepository } from "./historyRepository";
import { recordDiagnostic } from "./diagnostics";
import type { RuntimeSettings } from "./settingsStore";

let repository: HistoryRepository | undefined;
let repositoryPath = "";

function getRepository(): HistoryRepository {
  const nextPath = path.join(app.getPath("userData"), "history.json");
  if (!repository || repositoryPath !== nextPath) {
    repositoryPath = nextPath;
    repository = new HistoryRepository(nextPath, safeStorage, (message) =>
      recordDiagnostic("warning", "history.repository_warning", { message }),
    );
  }
  return repository;
}

export function listHistory(): Promise<PromptHistoryRecord[]> {
  return getRepository().list();
}

export function appendHistory(
  request: OptimizeRequest,
  optimizedPrompt: string,
  route: Pick<RuntimeSettings, "routeName" | "model" | "engine">,
): Promise<void> {
  return getRepository().append(request, optimizedPrompt, route);
}
