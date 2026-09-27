import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { BudgetStatus } from "../../shared/types";
import {
  JsonDocumentError,
  JsonStorageError,
  loadValidatedJsonFile,
  writeJsonFileRecoverably,
} from "../infrastructure/jsonFile";
import { SerialTaskQueue } from "../infrastructure/serialTaskQueue";
import { PublicError } from "./publicError";
import type { UsageLimitSettings } from "./settingsRepository";

const MAX_USAGE_FILE_BYTES = 256 * 1024;

const usageStateSchema = z.strictObject({
  date: z.string(),
  requestTimestamps: z.array(z.number().int().nonnegative()).max(1_000),
  reservedTokens: z.number().int().nonnegative(),
  // Older usage files did not track in-flight requests; their charged total stays intact.
  pendingReservations: z.array(z.strictObject({
    id: z.uuid(),
    estimatedTokens: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
  })).max(1_000).default([]),
});

type UsageState = z.infer<typeof usageStateSchema>;

export interface UsageReservation {
  id: string;
  date: string;
  estimatedTokens: number;
}

function decodeUsageState(raw: unknown): UsageState {
  const parsed = usageStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new JsonDocumentError("ERR_JSON_SCHEMA", "Invalid usage schema");
  }
  return parsed.data;
}

function localDate(now: number): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyState(now: number): UsageState {
  return {
    date: localDate(now),
    requestTimestamps: [],
    reservedTokens: 0,
    pendingReservations: [],
  };
}

export function estimateRequestTokens(
  prompt: string,
  maxOutputTokens: number,
  systemOverheadTokens = 1_000,
): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of prompt) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  const inputEstimate = Math.ceil(ascii / 4 + nonAscii / 1.5);
  return inputEstimate + systemOverheadTokens + maxOutputTokens;
}

function pruneHourlyRequests(state: UsageState, now: number): UsageState {
  const oneHourAgo = now - 60 * 60 * 1_000;
  return {
    ...state,
    requestTimestamps: state.requestTimestamps.filter(
      (timestamp) => timestamp > oneHourAgo && timestamp <= now,
    ),
    // Expired receipt metadata may be discarded, but its full charge is retained.
    pendingReservations: state.pendingReservations.filter(
      (reservation) =>
        reservation.createdAt > oneHourAgo && reservation.createdAt <= now,
    ),
  };
}

export class UsageRepository {
  private readonly operations = new SerialTaskQueue();

  constructor(
    private readonly filePath: string,
    private readonly onWarning: (message: string) => void = () => undefined,
  ) {}

  private async readState(now: number): Promise<UsageState> {
    let loaded;
    try {
      loaded = await loadValidatedJsonFile(
        this.filePath,
        MAX_USAGE_FILE_BYTES,
        decodeUsageState,
        false,
      );
    } catch (error) {
      const code = error instanceof JsonStorageError
        ? error.primaryCode
        : "ERR_JSON_IO";
      this.onWarning(`用量计数文件不可用，已暂停请求（${code}）`);
      throw new PublicError("用量计数文件不可用，已暂停模型请求以防额度失控；请检查文件或联系维护人员");
    }
    if (loaded.status === "missing" || loaded.value.date !== localDate(now)) {
      return emptyState(now);
    }
    return loaded.value;
  }

  private async writeState(state: UsageState): Promise<void> {
    await writeJsonFileRecoverably(this.filePath, state);
  }

  reserve(
    settings: UsageLimitSettings,
    prompt: string,
    now = Date.now(),
    options: {
      maxOutputTokens?: number;
      systemOverheadTokens?: number;
    } = {},
  ): Promise<UsageReservation> {
    return this.operations.run(async () => {
      const state = pruneHourlyRequests(await this.readState(now), now);
      const estimate = estimateRequestTokens(
        prompt,
        options.maxOutputTokens ?? settings.maxOutputTokens,
        options.systemOverheadTokens ?? 1_000,
      );
      if (state.requestTimestamps.length >= settings.maxRequestsPerHour) {
        throw new PublicError(
          `已达到每小时 ${settings.maxRequestsPerHour} 次的请求上限`,
        );
      }
      if (state.reservedTokens + estimate > settings.dailyTokenBudget) {
        throw new PublicError(
          `本次最多预留 ${estimate.toLocaleString()} tokens，已超过今日预算`,
        );
      }
      state.requestTimestamps.push(now);
      state.reservedTokens += estimate;
      const reservation: UsageReservation = {
        id: randomUUID(),
        date: state.date,
        estimatedTokens: estimate,
      };
      state.pendingReservations.push({
        id: reservation.id,
        estimatedTokens: estimate,
        createdAt: now,
      });
      await this.writeState(state);
      return reservation;
    });
  }

  settle(
    reservation: UsageReservation,
    actualTokens?: number,
    now = Date.now(),
  ): Promise<boolean> {
    return this.operations.run(async () => {
      const state = pruneHourlyRequests(await this.readState(now), now);
      if (state.date !== reservation.date) return false;
      const index = state.pendingReservations.findIndex(
        (candidate) => candidate.id === reservation.id,
      );
      if (index < 0) return false;
      const pending = state.pendingReservations[index]!;
      if (pending.estimatedTokens !== reservation.estimatedTokens) {
        throw new PublicError("用量预留记录不一致，已暂停结算");
      }
      // Without trustworthy provider usage, retain the full pre-charge.
      const charged = Number.isSafeInteger(actualTokens) &&
        actualTokens !== undefined && actualTokens > 0
        ? actualTokens
        : pending.estimatedTokens;
      const nextTotal = state.reservedTokens - pending.estimatedTokens + charged;
      if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) {
        throw new PublicError("用量结算数值异常，已暂停结算");
      }
      state.reservedTokens = nextTotal;
      state.pendingReservations.splice(index, 1);
      await this.writeState(state);
      return true;
    });
  }

  status(
    settings: UsageLimitSettings,
    now = Date.now(),
  ): Promise<BudgetStatus> {
    return this.operations.run(async () => {
      const state = pruneHourlyRequests(await this.readState(now), now);
      return {
        date: state.date,
        requestsThisHour: state.requestTimestamps.length,
        maxRequestsPerHour: settings.maxRequestsPerHour,
        reservedTokensToday: state.reservedTokens,
        dailyTokenBudget: settings.dailyTokenBudget,
      };
    });
  }
}
