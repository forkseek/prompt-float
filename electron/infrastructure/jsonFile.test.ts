import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  JsonDocumentError,
  JsonStorageError,
  loadValidatedJsonFile,
  parseJsonText,
  readJsonFile,
  stringifyJson,
  writeJsonFileRecoverably,
} from "./jsonFile";

const temporaryDirectories: string[] = [];

async function createFilePath(fileName = "state.json"): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "prompt-float-json-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, fileName);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JSON file infrastructure", () => {
  it("parses a UTF-8 BOM without weakening JSON validation", () => {
    expect(parseJsonText('\uFEFF{"enabled":true}')).toEqual({ enabled: true });

    const secret = "secret-value-that-must-not-leak";
    try {
      parseJsonText(`{"credential":"${secret}"`);
      throw new Error("Expected malformed JSON to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonDocumentError);
      expect(error).toMatchObject({ code: "ERR_JSON_INVALID" });
      expect(String(error)).not.toContain(secret);
    }
  });

  it("uses deterministic formatting and rejects lossy numeric values", () => {
    expect(stringifyJson({ enabled: true, count: 2 })).toBe(
      '{\n  "enabled": true,\n  "count": 2\n}\n',
    );
    expect(() => stringifyJson({ value: Number.NaN })).toThrow(
      "JSON value is not serializable",
    );
    expect(() => stringifyJson({ value: Number.POSITIVE_INFINITY })).toThrow(
      "JSON value is not serializable",
    );
    expect(() => stringifyJson(undefined)).toThrow(
      "JSON value is not serializable",
    );
  });

  it("bounds reads before parsing and accepts files within the limit", async () => {
    const filePath = await createFilePath();
    await fs.writeFile(filePath, '\uFEFF{"route":"local"}', "utf8");
    await expect(readJsonFile(filePath, 64)).resolves.toEqual({ route: "local" });

    await fs.writeFile(filePath, JSON.stringify({ value: "x".repeat(128) }));
    await expect(readJsonFile(filePath, 64)).rejects.toMatchObject({
      code: "ERR_JSON_TOO_LARGE",
    });
  });

  it("replaces JSON while retaining the previous revision as a backup", async () => {
    const filePath = await createFilePath();
    await fs.writeFile(filePath, '{"version":1}', "utf8");

    await writeJsonFileRecoverably(filePath, { version: 2 });

    expect(await fs.readFile(filePath, "utf8")).toBe(
      '{\n  "version": 2\n}\n',
    );
    expect(await fs.readFile(`${filePath}.bak`, "utf8")).toBe('{"version":1}');
    expect(await fs.readdir(path.dirname(filePath))).toEqual([
      "state.json",
      "state.json.bak",
    ]);
  });

  it("restores a valid backup after a crash between renames", async () => {
    const filePath = await createFilePath();
    await fs.writeFile(`${filePath}.bak`, '{"version":1}', "utf8");

    const loaded = await loadValidatedJsonFile(
      filePath,
      64,
      (raw) => raw as { version: number },
      true,
    );
    expect(loaded).toEqual({ status: "recovered", value: { version: 1 } });
    expect(await fs.readFile(filePath, "utf8")).toBe('{"version":1}');
    expect(await fs.readFile(`${filePath}.bak`, "utf8")).toBe('{"version":1}');
  });

  it("quarantines a torn primary and restores a validated backup", async () => {
    const filePath = await createFilePath();
    await fs.writeFile(filePath, '{"version":', "utf8");
    await fs.writeFile(`${filePath}.bak`, '{"version":1}', "utf8");

    const loaded = await loadValidatedJsonFile(
      filePath,
      64,
      (raw) => raw as { version: number },
      true,
    );
    expect(loaded.status).toBe("recovered");
    expect(await fs.readFile(filePath, "utf8")).toBe('{"version":1}');
    const files = await fs.readdir(path.dirname(filePath));
    const quarantined = files.find((name) => name.startsWith("state.json.corrupt-"));
    expect(quarantined).toBeDefined();
    expect(await fs.readFile(path.join(path.dirname(filePath), quarantined!), "utf8"))
      .toBe('{"version":');
  });

  it("fails closed when the backup is invalid or recovery is not allowed", async () => {
    const filePath = await createFilePath();
    await fs.writeFile(filePath, "{bad", "utf8");
    await fs.writeFile(`${filePath}.bak`, '{"version":1}', "utf8");
    await expect(loadValidatedJsonFile(
      filePath,
      64,
      (raw) => raw as { version: number },
      false,
    )).rejects.toBeInstanceOf(JsonStorageError);
    expect(await fs.readFile(filePath, "utf8")).toBe("{bad");

    await fs.writeFile(`${filePath}.bak`, "{also-bad", "utf8");
    await expect(loadValidatedJsonFile(
      filePath,
      64,
      (raw) => raw as { version: number },
      true,
    )).rejects.toMatchObject({
      primaryCode: "ERR_JSON_INVALID",
      backupCode: "ERR_JSON_INVALID",
    });
  });

  it("classifies a missing primary separately from a damaged backup", async () => {
    const filePath = await createFilePath();
    await fs.writeFile(`${filePath}.bak`, "{bad", "utf8");

    await expect(loadValidatedJsonFile(
      filePath,
      64,
      (raw) => raw as { version: number },
      true,
    )).rejects.toMatchObject({
      primaryCode: "ENOENT",
      backupCode: "ERR_JSON_INVALID",
    });
  });

  it("rejects invalid size limits before touching the filesystem", async () => {
    await expect(readJsonFile("missing.json", 0)).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});
