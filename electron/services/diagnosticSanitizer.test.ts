import { describe, expect, it } from "vitest";
import {
  formatDiagnosticLine,
  redactDiagnosticText,
  sanitizeDiagnosticDetails,
} from "./diagnosticSanitizer";

describe("diagnostic sanitization", () => {
  it("redacts secrets and prompt content recursively", () => {
    const sanitized = sanitizeDiagnosticDetails({
      routeId: "route-1",
      apiKey: "sk-secret-value",
      nested: {
        authorization: "Bearer token-value",
        prompt: "private text",
      },
    });
    expect(sanitized).toEqual({
      routeId: "route-1",
      apiKey: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        prompt: "[REDACTED]",
      },
    });
  });

  it("redacts secret-shaped text and emits one JSON line", () => {
    expect(
      redactDiagnosticText("Authorization: Bearer abcdefghijkl"),
    ).not.toContain("abcdefghijkl");
    const line = formatDiagnosticLine({
      timestamp: "2026-09-22T00:00:00.000Z",
      level: "info",
      code: "test",
      details: {},
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toMatchObject({ code: "test" });
  });

  it("bounds nested, array and non-JSON diagnostic values", () => {
    const sanitized = sanitizeDiagnosticDetails({
      nullValue: null,
      count: 2,
      enabled: false,
      list: ["sk-1234567890abcdef"],
      callback: () => "not recorded",
      deep: { a: { b: { c: { d: "too deep" } } } },
    });

    expect(sanitized).toMatchObject({
      nullValue: null,
      count: 2,
      enabled: false,
      list: ["[REDACTED]"],
      deep: { a: { b: { c: { d: "[TRUNCATED]" } } } },
    });
    expect(typeof sanitized.callback).toBe("string");
  });
});
