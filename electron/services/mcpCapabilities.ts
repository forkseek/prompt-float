import { PublicError } from "./publicError";

export interface McpToolListingClient {
  getServerCapabilities(): { tools?: unknown } | undefined;
  listTools(
    params?: { cursor?: string },
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<{ tools: Array<{ name: string }>; nextCursor?: string }>;
}

/** Negotiate the tools advertised by this exact MCP session before a model call. */
export async function negotiateMcpTools(
  client: McpToolListingClient,
  requiredNames: readonly string[],
  signal: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  if (!client.getServerCapabilities()?.tools) {
    throw new PublicError("MCP 服务未声明工具能力，无法执行提示词优化");
  }
  const available = new Set<string>();
  const seenCursors = new Set<string>();
  let listedTools = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 8; page += 1) {
    const response = await client.listTools(
      cursor ? { cursor } : undefined,
      { signal, timeout: timeoutMs },
    );
    for (const tool of response.tools) {
      listedTools += 1;
      if (listedTools > 512) {
        throw new PublicError("MCP 工具列表过大，已停止能力协商");
      }
      available.add(tool.name);
    }
    cursor = response.nextCursor;
    if (!cursor) {
      const missing = requiredNames.filter((name) => !available.has(name));
      if (missing.length > 0) {
        throw new PublicError(
          `MCP 已连接，但缺少 Prompt Optimizer 工具：${missing.join(", ")}`,
        );
      }
      return;
    }
    if (seenCursors.has(cursor)) {
      throw new PublicError("MCP 工具列表分页异常，已停止能力协商");
    }
    seenCursors.add(cursor);
  }
  throw new PublicError("MCP 工具列表分页过多，已停止能力协商");
}
