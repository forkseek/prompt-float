import * as http from "node:http";
import * as https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { RouteTiming } from "../../shared/types";
import { PublicError } from "./publicError";

export interface TimedHttpRequestOptions {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface TimedHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  timing: RouteTiming;
}

function elapsed(startedAt: number, eventAt: number | undefined): number | undefined {
  return eventAt === undefined ? undefined : Math.max(0, eventAt - startedAt);
}

function normalizedError(
  error: unknown,
  timedOut: boolean,
  timeoutMs: number,
  isLoopback: boolean,
): PublicError {
  if (timedOut) {
    return new PublicError(`路由测试超时（${Math.ceil(timeoutMs / 1_000)} 秒）`);
  }
  if (error instanceof PublicError) return error;
  if (isLoopback && (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
    return new PublicError("本机路由端口未监听，请启动对应 API/MCP 服务或检查端口");
  }
  return new PublicError("无法连接路由，请检查地址、网络和防火墙");
}

export async function sendTimedHttpRequest(
  options: TimedHttpRequestOptions,
): Promise<TimedHttpResponse> {
  const parsed = new URL(options.url);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname.toLowerCase(),
  );
  const client = parsed.protocol === "https:" ? https : http;
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxResponseBytes = options.maxResponseBytes ?? 65_536;
  const headers = { ...options.headers };
  if (options.body !== undefined && !Object.keys(headers).some(
    (header) => header.toLowerCase() === "content-length",
  )) {
    headers["Content-Length"] = String(Buffer.byteLength(options.body));
  }

  return new Promise<TimedHttpResponse>((resolve, reject) => {
    let socketAssignedAt: number | undefined;
    let lookupAt: number | undefined;
    let connectAt: number | undefined;
    let secureConnectAt: number | undefined;
    let requestFinishedAt: number | undefined;
    let headersAt: number | undefined;
    let firstResponseAt: number | undefined;
    let timedOut = false;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", abortRequest);
      callback();
    };

    const request = client.request(
      parsed,
      {
        method: options.method,
        headers,
        agent: false,
      },
      (response) => {
        headersAt = Date.now();
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer | string) => {
          if (firstResponseAt === undefined) firstResponseAt = Date.now();
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buffer.length;
          if (received > maxResponseBytes) {
            response.destroy(
              new PublicError("路由测试响应过大，已停止读取"),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("error", (error) =>
          finish(() => reject(normalizedError(error, timedOut, timeoutMs, isLoopback))),
        );
        response.on("end", () => {
          const completedAt = Date.now();
          const socketStart = socketAssignedAt ?? startedAt;
          const tcpStart = lookupAt ?? socketStart;
          const sendAt = requestFinishedAt ?? completedAt;
          finish(() =>
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              timing: {
                dnsMs:
                  lookupAt === undefined
                    ? undefined
                    : Math.max(0, lookupAt - socketStart),
                tcpMs:
                  connectAt === undefined
                    ? undefined
                    : Math.max(0, connectAt - tcpStart),
                tlsMs:
                  secureConnectAt === undefined || connectAt === undefined
                    ? undefined
                    : Math.max(0, secureConnectAt - connectAt),
                sendMs: Math.max(0, sendAt - startedAt),
                firstByteMs: elapsed(startedAt, headersAt),
                firstResponseMs: elapsed(startedAt, firstResponseAt),
                totalMs: Math.max(0, completedAt - startedAt),
              },
            }),
          );
        });
      },
    );

    const abortRequest = (): void => {
      request.destroy(new Error("aborted"));
    };
    if (options.signal?.aborted) {
      abortRequest();
    } else {
      options.signal?.addEventListener("abort", abortRequest, { once: true });
    }

    request.on("socket", (socket) => {
      socketAssignedAt = Date.now();
      socket.once("lookup", () => {
        lookupAt = Date.now();
      });
      socket.once("connect", () => {
        connectAt = Date.now();
      });
      socket.once("secureConnect", () => {
        secureConnectAt = Date.now();
      });
    });
    request.on("finish", () => {
      requestFinishedAt = Date.now();
    });
    const deadline = setTimeout(() => {
      timedOut = true;
      request.destroy(new Error("timeout"));
    }, timeoutMs);
    request.on("error", (error) =>
      finish(() => reject(normalizedError(error, timedOut, timeoutMs, isLoopback))),
    );

    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}
