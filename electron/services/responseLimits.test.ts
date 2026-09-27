import { describe, expect, it } from "vitest";
import { createBoundedFetch, readBoundedJson } from "./responseLimits";

describe("remote response limits", () => {
  it("accepts a JSON body exactly at the byte limit", async () => {
    const body = JSON.stringify({ model: "测试" });
    const result = await readBoundedJson(
      new Response(body),
      Buffer.byteLength(body),
      "响应过大",
    );
    expect(result).toEqual({ model: "测试" });
  });

  it("rejects an oversized Content-Length before parsing", async () => {
    await expect(readBoundedJson(
      new Response("{}", { headers: { "content-length": "100" } }),
      10,
      "响应过大",
    )).rejects.toThrow("响应过大");
  });

  it("enforces actual bytes when Content-Length is missing or false", async () => {
    for (const headers of [undefined, { "content-length": "1" }]) {
      await expect(readBoundedJson(
        new Response('{"data":"123456789"}', { headers }),
        12,
        "响应过大",
      )).rejects.toThrow("响应过大");
    }
  });

  it("stops a chunked body as soon as its cumulative bytes exceed the limit", async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode('{"data":"'), encoder.encode('123456789"}')];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]!);
        else controller.close();
      },
    });
    await expect(readBoundedJson(
      new Response(body),
      12,
      "响应过大",
    )).rejects.toThrow("响应过大");
  });

  it("bounds responses supplied to the MCP SDK without buffering first", async () => {
    const fetchImpl = createBoundedFetch(
      async () => new Response('{"content":"too long"}', {
        headers: { "content-type": "application/json" },
      }),
      8,
      "MCP 响应过大",
    );
    const response = await fetchImpl("http://127.0.0.1/mcp");
    await expect(response.json()).rejects.toThrow("MCP 响应过大");
  });
});
