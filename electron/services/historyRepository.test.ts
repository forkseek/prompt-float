import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { OptimizeRequest } from "../../shared/types";
import { HistoryRepository, HISTORY_LIMIT } from "./historyRepository";
import type { SecureStorageAdapter } from "./settingsRepository";

const temporaryDirectories: string[] = [];
const fakeSecureStorage: SecureStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`cipher:${value}`, "utf8"),
  decryptString: (value) => {
    const text = value.toString("utf8");
    if (!text.startsWith("cipher:")) throw new Error("invalid ciphertext");
    return text.slice("cipher:".length);
  },
};
const route = {
  routeName: "本机测试路由",
  model: "test-model",
  engine: "direct" as const,
};

async function createRepository(storage = fakeSecureStorage) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-float-history-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "history.json");
  return { filePath, repository: new HistoryRepository(filePath, storage) };
}

function request(prompt: string): OptimizeRequest {
  return { requestId: randomUUID(), mode: "user", prompt };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("history repository", () => {
  it("persists full records across instances without plaintext in the JSON file", async () => {
    const { filePath, repository } = await createRepository();
    const input = {
      ...request("独特的原始提示词"),
      mode: "iterate" as const,
      requirements: "语气更正式",
    };
    await repository.append(input, "独特的优化后提示词", route);

    const disk = await fs.readFile(filePath, "utf8");
    expect(disk).not.toContain(input.prompt);
    expect(disk).not.toContain("独特的优化后提示词");
    const reloaded = await new HistoryRepository(filePath, fakeSecureStorage).list();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({
      originalPrompt: input.prompt,
      optimizedPrompt: "独特的优化后提示词",
      requirements: input.requirements,
      mode: "iterate",
      routeName: route.routeName,
      model: route.model,
      engine: route.engine,
    });
    expect(reloaded[0]?.id).toBeTruthy();
    expect(reloaded[0]?.optimizedAt).toBeGreaterThan(0);
  });

  it("keeps only the newest 50 successful optimizations", async () => {
    const { repository } = await createRepository();
    for (let index = 0; index <= HISTORY_LIMIT; index += 1) {
      await repository.append(request(`原文-${index}`), `结果-${index}`, route);
    }
    const records = await repository.list();
    expect(records).toHaveLength(HISTORY_LIMIT);
    expect(records[0]?.originalPrompt).toBe("原文-50");
    expect(records.at(-1)?.originalPrompt).toBe("原文-1");
    expect(records.some((record) => record.originalPrompt === "原文-0")).toBe(false);
  });

  it("evicts older records before the encrypted file exceeds its read limit", async () => {
    const { filePath } = await createRepository();
    const repository = new HistoryRepository(filePath, fakeSecureStorage, undefined, 850);
    await repository.append(request("第一条" + "a".repeat(100)), "x".repeat(100), route);
    await repository.append(request("第二条" + "b".repeat(100)), "y".repeat(100), route);
    const records = await repository.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.originalPrompt).toContain("第二条");
    expect((await fs.stat(filePath)).size).toBeLessThanOrEqual(850);
  });

  it("recovers the last valid backup when the primary file is corrupted", async () => {
    const { filePath, repository } = await createRepository();
    await repository.append(request("第一条"), "结果一", route);
    await repository.append(request("第二条"), "结果二", route);
    await fs.writeFile(filePath, "{broken", "utf8");
    const recovered = await repository.list();
    expect(recovered.map((record) => record.originalPrompt)).toEqual(["第一条"]);
    expect(await new HistoryRepository(filePath, fakeSecureStorage).list())
      .toHaveLength(1);
  });

  it("fails closed without overwriting an unreadable primary and backup", async () => {
    const { filePath, repository } = await createRepository();
    await fs.writeFile(filePath, "{broken", "utf8");
    await fs.writeFile(`${filePath}.bak`, "{also-broken", "utf8");
    await expect(repository.append(request("新记录"), "结果", route))
      .rejects.toThrow("未覆盖原有数据");
    expect(await fs.readFile(filePath, "utf8")).toBe("{broken");
    expect(await fs.readFile(`${filePath}.bak`, "utf8")).toBe("{also-broken");
  });

  it("does not write history when OS secure storage is unavailable", async () => {
    const storage: SecureStorageAdapter = {
      ...fakeSecureStorage,
      isEncryptionAvailable: () => false,
    };
    const { filePath, repository } = await createRepository(storage);
    await expect(repository.append(request("私密原文"), "私密结果", route))
      .rejects.toThrow("系统安全存储不可用");
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
