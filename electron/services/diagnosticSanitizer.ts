import type { DiagnosticsEvent } from "../../shared/types";

const SENSITIVE_KEY =
  /(?:api.?key|authorization|credential|password|prompt|requirements|secret|token)/i;
const SECRET_TEXT_PATTERNS = [
  /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"']+/gi,
  /((?:api.?key|credential|password|secret|token)\s*[:=]\s*)[^\s,;"']+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
];

export function redactDiagnosticText(value: string): string {
  const keyedValue = SECRET_TEXT_PATTERNS.slice(0, 2).reduce(
    (current, pattern) => current.replace(pattern, "$1[REDACTED]"),
    value,
  );
  return keyedValue.replace(SECRET_TEXT_PATTERNS[2], "[REDACTED]").slice(0, 2_000);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return redactDiagnosticText(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key)
            ? "[REDACTED]"
            : sanitizeValue(item, depth + 1),
        ]),
    );
  }
  return String(value).slice(0, 500);
}

export function sanitizeDiagnosticDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeValue(details, 0) as Record<string, unknown>;
}

export function formatDiagnosticLine(event: DiagnosticsEvent): string {
  return `${JSON.stringify(event)}\n`;
}
