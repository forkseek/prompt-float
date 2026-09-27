import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  OptimizeRequest,
  PromptHistoryRecord,
} from "../../shared/types";
import {
  JsonDocumentError,
  JsonStorageError,
  loadValidatedJsonFile,
  parseJsonText,
  stringifyJson,
  writeJsonFileRecoverably,
} from "../infrastructure/jsonFile";
import { SerialTaskQueue } from "../infrastructure/serialTaskQueue";
import { PublicError } from "./publicError";
import type { RuntimeSettings, SecureStorageAdapter } from "./settingsRepository";

export const HISTORY_LIMIT = 50;
const MAX_HISTORY_FILE_BYTES = 32 * 1024 * 1024;
const historyRecordSchema: z.ZodType<PromptHistoryRecord> = z.strictObject({
  id: z.uuid(),
  originalPrompt: z.string().min(1).max(50_000),
  optimizedPrompt: z.string().min(1).max(200_000),
  optimizedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  mode: z.enum(["user", "system", "iterate"]),
  requirements: z.string().max(20_000).optional(),
  routeName: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
  engine: z.enum(["direct", "prompt-optimizer-mcp"]),
});
const historyDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  records: z.array(historyRecordSchema).max(HISTORY_LIMIT),
});
const encryptedEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  encryptedPayload: z.string().min(1).max(MAX_HISTORY_FILE_BYTES),
});

type HistoryDocument = z.infer<typeof historyDocumentSchema>;
type HistoryRoute = Pick<RuntimeSettings, "routeName" | "model" | "engine">;

export class HistoryRepository {
  private readonly queue = new SerialTaskQueue();

  constructor(
    private readonly filePath: string,
    private readonly secureStorage: SecureStorageAdapter,
    private readonly onWarning?: (message: string) => void,
    private readonly maxFileBytes = MAX_HISTORY_FILE_BYTES,
  ) {}

  list(): Promise<PromptHistoryRecord[]> {
    return this.queue.run(async () => (await this.load()).records);
  }

  append(
    request: OptimizeRequest,
    optimizedPrompt: string,
    route: HistoryRoute,
  ): Promise<void> {
    return this.queue.run(async () => {
      const document = await this.load();
      const record = historyRecordSchema.safeParse({
        id: randomUUID(),
        originalPrompt: request.prompt,
        optimizedPrompt,
        optimizedAt: Date.now(),
        mode: request.mode,
        requirements: request.requirements,
        routeName: route.routeName,
        model: route.model,
        engine: route.engine,
      });
      if (!record.success) {
        throw new PublicError("优化记录超出允许大小，无法保存历史记录");
      }
      // The newest 50 successful optimizations are the most useful to revisit.
      const next: HistoryDocument = {
        schemaVersion: 1,
        records: [record.data, ...document.records].slice(0, HISTORY_LIMIT),
      };
      while (next.records.length > 0) {
        const encryptedPayload = this.secureStorage
          .encryptString(stringifyJson(next))
          .toString("base64");
        const envelope = { schemaVersion: 1, encryptedPayload };
        if (Buffer.byteLength(stringifyJson(envelope), "utf8") <= this.maxFileBytes) {
          await writeJsonFileRecoverably(this.filePath, envelope);
          return;
        }
        next.records.pop();
      }
      throw new PublicError("单条优化记录过大，无法安全保存历史记录");
    });
  }

  private async load(): Promise<HistoryDocument> {
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new PublicError("系统安全存储不可用，历史记录无法安全读取或保存");
    }
    let loaded;
    try {
      loaded = await loadValidatedJsonFile(
        this.filePath,
        this.maxFileBytes,
        (raw) => this.decode(raw),
        true,
      );
    } catch (error) {
      if (error instanceof JsonStorageError) {
        throw new PublicError("历史记录文件无法读取，未覆盖原有数据");
      }
      throw error;
    }
    if (loaded.status === "missing") return { schemaVersion: 1, records: [] };
    if (loaded.status === "recovered") {
      this.onWarning?.("历史记录已从备份恢复");
    }
    return loaded.value;
  }

  private decode(raw: unknown): HistoryDocument {
    const envelope = encryptedEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      throw new JsonDocumentError("ERR_JSON_SCHEMA", "Invalid history envelope");
    }
    const ciphertext = Buffer.from(envelope.data.encryptedPayload, "base64");
    if (
      ciphertext.length === 0 ||
      ciphertext.toString("base64") !== envelope.data.encryptedPayload
    ) {
      throw new JsonDocumentError("ERR_JSON_SCHEMA", "Invalid encrypted history");
    }
    try {
      const document = historyDocumentSchema.safeParse(
        parseJsonText(this.secureStorage.decryptString(ciphertext)),
      );
      if (document.success) return document.data;
    } catch {
      // Both decryption errors and invalid plaintext must be treated as corruption.
    }
    throw new JsonDocumentError("ERR_JSON_SCHEMA", "Invalid history document");
  }
}
