import { describe, expect, it } from "vitest";
import { negotiateMcpTools, type McpToolListingClient } from "./mcpCapabilities";

const signal = new AbortController().signal;

describe("MCP capability negotiation", () => {
  it("finds a required tool on a later page", async () => {
    const cursors: Array<string | undefined> = [];
    const client: McpToolListingClient = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools: async (params) => {
        cursors.push(params?.cursor);
        return params?.cursor
          ? { tools: [{ name: "optimize-user-prompt" }] }
          : { tools: [{ name: "other" }], nextCursor: "next" };
      },
    };
    await expect(negotiateMcpTools(client, ["optimize-user-prompt"], signal))
      .resolves.toBeUndefined();
    expect(cursors).toEqual([undefined, "next"]);
  });

  it("rejects absent tool support and missing requested tools", async () => {
    const client: McpToolListingClient = {
      getServerCapabilities: () => ({}),
      listTools: async () => ({ tools: [] }),
    };
    await expect(negotiateMcpTools(client, ["optimize-user-prompt"], signal))
      .rejects.toThrow("未声明工具能力");
    client.getServerCapabilities = () => ({ tools: {} });
    await expect(negotiateMcpTools(client, ["iterate-prompt"], signal))
      .rejects.toThrow("缺少 Prompt Optimizer 工具");
  });

  it("fails closed on looping tool cursors", async () => {
    const client: McpToolListingClient = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools: async () => ({ tools: [], nextCursor: "loop" }),
    };
    await expect(negotiateMcpTools(client, ["optimize-user-prompt"], signal))
      .rejects.toThrow("分页异常");
  });

  it("rejects an oversized tool listing even if names are duplicated", async () => {
    const client: McpToolListingClient = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools: async () => ({
        tools: Array.from({ length: 513 }, () => ({ name: "same-tool" })),
      }),
    };
    await expect(negotiateMcpTools(client, ["same-tool"], signal))
      .rejects.toThrow("工具列表过大");
  });
});
