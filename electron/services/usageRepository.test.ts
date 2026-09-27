import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsageRepository, estimateRequestTokens } from "./usageRepository";

const temporaryDirectories: string[] = [];

async function createUsageFixture(): Promise<{
  filePath: string;
  repository: UsageRepository;
}> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-usage-"),
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "usage.json");
  return { filePath, repository: new UsageRepository(filePath) };
}

async function createRepository(): Promise<UsageRepository> {
  return (await createUsageFixture()).repository;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("usage repository", () => {
  it("uses a conservative estimate that includes output allowance", () => {
    expect(estimateRequestTokens("abcd中文", 2_000)).toBe(3_003);
  });

  it("serializes concurrent reservations and enforces the hourly limit", async () => {
    const repository = await createRepository();
    const limits = {
      maxRequestsPerHour: 1,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    const outcomes = await Promise.allSettled([
      repository.reserve(limits, "first", now),
      repository.reserve(limits, "second", now + 1),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  it("settles reported usage exactly once and retains the request count", async () => {
    const { filePath, repository } = await createUsageFixture();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    const receipt = await repository.reserve(limits, "prompt", now);
    expect((await repository.status(limits, now)).reservedTokensToday)
      .toBe(receipt.estimatedTokens);
    expect(await repository.settle(receipt, 173, now + 1)).toBe(true);
    expect(await repository.settle(receipt, 1, now + 2)).toBe(false);
    expect(await repository.status(limits, now + 2)).toMatchObject({
      requestsThisHour: 1,
      reservedTokensToday: 173,
    });
    expect(JSON.parse(await fs.readFile(filePath, "utf8")))
      .toMatchObject({ pendingReservations: [] });
  });

  it("charges more than the estimate when reported usage exceeds it", async () => {
    const repository = await createRepository();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 10_000,
      maxOutputTokens: 1_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    const receipt = await repository.reserve(limits, "prompt", now);
    await repository.settle(receipt, 9_500, now + 1);
    expect((await repository.status(limits, now + 1)).reservedTokensToday).toBe(9_500);
    await expect(repository.reserve(limits, "second", now + 2))
      .rejects.toThrow("已超过今日预算");
  });

  it("keeps the full charge on missing usage and after an interrupted request", async () => {
    const { filePath, repository } = await createUsageFixture();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    const interrupted = await repository.reserve(limits, "first", now);
    const restarted = new UsageRepository(filePath);
    expect((await restarted.status(limits, now + 1)).reservedTokensToday)
      .toBe(interrupted.estimatedTokens);
    const second = await restarted.reserve(limits, "second", now + 2);
    await restarted.settle(second, undefined, now + 3);
    expect((await restarted.status(limits, now + 3)).reservedTokensToday)
      .toBe(interrupted.estimatedTokens + second.estimatedTokens);
  });

  it("loads the previous usage schema without clearing its charge", async () => {
    const { filePath, repository } = await createUsageFixture();
    const now = new Date(2026, 8, 12, 12).getTime();
    await fs.writeFile(filePath, JSON.stringify({
      date: "2026-09-12",
      requestTimestamps: [now],
      reservedTokens: 4_321,
    }));
    expect((await repository.status({
      maxRequestsPerHour: 10,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    }, now + 1)).reservedTokensToday).toBe(4_321);
  });

  it("blocks a request whose reservation would exceed the daily budget", async () => {
    const repository = await createRepository();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 10_000,
      maxOutputTokens: 4_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    await repository.reserve(limits, "first", now);
    await expect(repository.reserve(limits, "second", now + 1)).rejects.toThrow(
      "已超过今日预算",
    );
  });

  it("resets counters on a new local day", async () => {
    const repository = await createRepository();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    };
    const firstDay = new Date(2026, 8, 12, 12).getTime();
    await repository.reserve(limits, "prompt", firstDay);
    expect((await repository.status(limits, firstDay)).reservedTokensToday).toBeGreaterThan(0);
    expect(
      (await repository.status(limits, firstDay + 24 * 60 * 60 * 1_000))
        .reservedTokensToday,
    ).toBe(0);
  });

  it("blocks model requests when usage is malformed instead of resetting the budget", async () => {
    const { filePath, repository } = await createUsageFixture();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    await fs.writeFile(filePath, "{broken", "utf8");
    await expect(repository.reserve(limits, "prompt", now)).rejects.toThrow(
      "已暂停模型请求",
    );
    await expect(repository.status(limits, now)).rejects.toThrow(
      "已暂停模型请求",
    );
    expect(await fs.readFile(filePath, "utf8")).toBe("{broken");
  });

  it("does not roll back to an older usage backup after a torn write", async () => {
    const { filePath, repository } = await createUsageFixture();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    await repository.reserve(limits, "first", now);
    await repository.reserve(limits, "second", now + 1);
    const backup = await fs.readFile(`${filePath}.bak`, "utf8");
    await fs.writeFile(filePath, "{torn", "utf8");

    await expect(repository.reserve(limits, "third", now + 2)).rejects.toThrow(
      "已暂停模型请求",
    );
    expect(await fs.readFile(filePath, "utf8")).toBe("{torn");
    expect(await fs.readFile(`${filePath}.bak`, "utf8")).toBe(backup);
  });

  it("rejects an invalid usage schema without clearing the file", async () => {
    const { filePath, repository } = await createUsageFixture();
    const limits = {
      maxRequestsPerHour: 10,
      dailyTokenBudget: 100_000,
      maxOutputTokens: 1_000,
    };
    const now = new Date(2026, 8, 12, 12).getTime();
    await fs.writeFile(filePath, '{"date":"2026-09-12","reservedTokens":-1}', "utf8");
    await expect(repository.reserve(limits, "prompt", now)).rejects.toThrow(
      "已暂停模型请求",
    );
  });
});
