import { describe, expect, it } from "vitest";
import {
  assertEndpointConfirmed,
  buildModelsUrl,
  inspectEndpoint,
} from "./endpointPolicy";

describe("endpoint policy", () => {
  it("requires HTTPS for remote hosts", () => {
    expect(() => inspectEndpoint("http://api.example.com/v1")).toThrow(
      "远程 API 必须使用 HTTPS",
    );
    expect(inspectEndpoint("https://api.example.com/v1").displayHost).toBe(
      "api.example.com",
    );
  });

  it("allows HTTP only on exact loopback hosts", () => {
    expect(inspectEndpoint("http://127.0.0.1:3000/mcp").isLoopback).toBe(true);
    expect(inspectEndpoint("http://localhost:3000/mcp").isLoopback).toBe(true);
    expect(inspectEndpoint("http://[::1]:3000/mcp").isLoopback).toBe(true);
    expect(() => inspectEndpoint("http://localhost.example.com/v1")).toThrow();
  });

  it("rejects credentials, query strings and non-HTTP protocols", () => {
    expect(() => inspectEndpoint("https://user:pass@example.com/v1")).toThrow();
    expect(() => inspectEndpoint("https://example.com/v1?key=secret")).toThrow();
    expect(() => inspectEndpoint("file:///tmp/service")).toThrow();
  });

  it("requires an exact confirmed remote hostname", () => {
    const endpoint = inspectEndpoint("https://API.Example.com/v1");
    expect(() => assertEndpointConfirmed(endpoint, "other.example.com")).toThrow(
      "请先确认数据发送域名",
    );
    expect(() => assertEndpointConfirmed(endpoint, "api.example.com")).not.toThrow();
  });

  it("builds models URLs for both base and completion endpoints", () => {
    expect(buildModelsUrl("https://example.com/v1")).toBe(
      "https://example.com/v1/models",
    );
    expect(
      buildModelsUrl("https://example.com/v1/chat/completions"),
    ).toBe("https://example.com/v1/models");
  });
});
