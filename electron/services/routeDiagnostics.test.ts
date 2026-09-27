import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { sendTimedHttpRequest } from "./routeDiagnostics";

async function withHeartbeatServer(
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    const heartbeat = setInterval(() => response.write("x"), 15);
    const completion = setTimeout(() => response.end("done"), 350);
    response.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(completion);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("No test port");
  }
  try {
    await run(`http://127.0.0.1:${address.port}/probe`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("route probe deadline", () => {
  it("explains when a local API or MCP port is not listening", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await expect(sendTimedHttpRequest({
      url: `http://127.0.0.1:${address.port}/mcp`,
      method: "GET",
      timeoutMs: 1_000,
    })).rejects.toThrow("本机路由端口未监听");
  });

  it("expires at a total deadline even when the server sends heartbeats", async () => {
    await withHeartbeatServer(async (url) => {
      await expect(sendTimedHttpRequest({
        url,
        method: "GET",
        timeoutMs: 80,
        maxResponseBytes: 1_024,
      })).rejects.toThrow("路由测试超时");
    });
  });

  it("stops the network request when its caller cancels", async () => {
    await withHeartbeatServer(async (url) => {
      const controller = new AbortController();
      const cancellation = setTimeout(() => controller.abort(), 60);
      try {
        await expect(sendTimedHttpRequest({
          url,
          method: "GET",
          signal: controller.signal,
          timeoutMs: 1_000,
          maxResponseBytes: 1_024,
        })).rejects.toThrow("无法连接路由");
      } finally {
        clearTimeout(cancellation);
      }
    });
  });
});
