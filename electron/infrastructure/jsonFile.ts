import { promises as fs } from "node:fs";
import {
  restoreTextFileFromBackup,
  writeTextFileRecoverably,
} from "./atomicFile";

const UTF8_BOM = "\uFEFF";
const READ_CHUNK_BYTES = 64 * 1024;

export type JsonDocumentErrorCode =
  | "ERR_JSON_INVALID"
  | "ERR_JSON_NOT_FILE"
  | "ERR_JSON_TOO_LARGE"
  | "ERR_JSON_SCHEMA"
  | "ERR_JSON_PERMISSION"
  | "ERR_JSON_IO"
  | "ERR_JSON_RECOVERY"
  | "ERR_JSON_NOT_SERIALIZABLE";

export class JsonDocumentError extends Error {
  constructor(
    readonly code: JsonDocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JsonDocumentError";
  }
}

export function parseJsonText(content: string): unknown {
  const normalized = content.startsWith(UTF8_BOM)
    ? content.slice(UTF8_BOM.length)
    : content;
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    // Do not include source text in the error because persisted JSON can contain secrets.
    throw new JsonDocumentError("ERR_JSON_INVALID", "Invalid JSON document");
  }
}

export function stringifyJson(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(
      value,
      (_key, candidate: unknown) => {
        if (typeof candidate === "number" && !Number.isFinite(candidate)) {
          throw new TypeError("Non-finite JSON number");
        }
        return candidate;
      },
      2,
    );
  } catch {
    throw new JsonDocumentError(
      "ERR_JSON_NOT_SERIALIZABLE",
      "JSON value is not serializable",
    );
  }

  if (serialized === undefined) {
    throw new JsonDocumentError(
      "ERR_JSON_NOT_SERIALIZABLE",
      "JSON value is not serializable",
    );
  }
  return `${serialized}\n`;
}

export async function readJsonFile(
  filePath: string,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }

  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new JsonDocumentError(
        "ERR_JSON_NOT_FILE",
        "JSON path is not a regular file",
      );
    }
    if (stat.size > maxBytes) {
      throw new JsonDocumentError(
        "ERR_JSON_TOO_LARGE",
        "JSON document exceeds the configured size limit",
      );
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const chunk = Buffer.allocUnsafe(
        Math.min(READ_CHUNK_BYTES, maxBytes + 1 - totalBytes),
      );
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    if (totalBytes > maxBytes) {
      throw new JsonDocumentError(
        "ERR_JSON_TOO_LARGE",
        "JSON document exceeds the configured size limit",
      );
    }
    return parseJsonText(Buffer.concat(chunks, totalBytes).toString("utf8"));
  } finally {
    await handle.close();
  }
}

export async function writeJsonFileRecoverably(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeTextFileRecoverably(filePath, stringifyJson(value));
}

export class JsonStorageError extends Error {
  constructor(
    readonly primaryCode: JsonDocumentErrorCode | "ENOENT",
    readonly backupCode: JsonDocumentErrorCode | "ENOENT",
  ) {
    super("Stored JSON document is unavailable");
    this.name = "JsonStorageError";
  }
}

function errorCode(error: unknown): JsonDocumentErrorCode | "ENOENT" {
  if (error instanceof JsonDocumentError) return error.code;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return code;
  if (code === "EACCES" || code === "EPERM") return "ERR_JSON_PERMISSION";
  return "ERR_JSON_IO";
}

export type JsonLoadResult<T> =
  | { status: "missing" }
  | { status: "primary" | "recovered"; value: T };

export async function loadValidatedJsonFile<T>(
  filePath: string,
  maxBytes: number,
  validate: (raw: unknown) => T,
  recoverFromBackup: boolean,
): Promise<JsonLoadResult<T>> {
  const readValidated = async (candidate: string): Promise<T> =>
    validate(await readJsonFile(candidate, maxBytes));

  let primaryCode: JsonDocumentErrorCode | "ENOENT";
  try {
    return { status: "primary", value: await readValidated(filePath) };
  } catch (error) {
    primaryCode = errorCode(error);
  }

  const backupPath = `${filePath}.bak`;
  let backupCode: JsonDocumentErrorCode | "ENOENT";
  try {
    const value = await readValidated(backupPath);
    if (recoverFromBackup) {
      try {
        await restoreTextFileFromBackup(filePath);
      } catch {
        throw new JsonDocumentError(
          "ERR_JSON_RECOVERY",
          "Unable to restore JSON backup",
        );
      }
      return { status: "recovered", value };
    }
    // A stale usage backup may undercount requests; leave both files intact.
    backupCode = "ERR_JSON_RECOVERY";
  } catch (error) {
    backupCode = errorCode(error);
  }

  if (primaryCode === "ENOENT" && backupCode === "ENOENT") {
    return { status: "missing" };
  }
  throw new JsonStorageError(
    primaryCode,
    backupCode,
  );
}
