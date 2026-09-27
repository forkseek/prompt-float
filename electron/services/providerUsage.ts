export type ProviderResponseFormat = "openai" | "anthropic" | "gemini";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function sumKnown(...values: Array<number | undefined>): number | undefined {
  if (values.some((value) => value === undefined)) return undefined;
  const sum = values.reduce<number>((total, value) => total + value!, 0);
  return Number.isSafeInteger(sum) && sum > 0 ? sum : undefined;
}

/** Only complete, provider-reported usage can reduce a pre-reserved charge. */
export class ProviderUsageCollector {
  private anthropicInput: number | undefined;
  private anthropicOutput: number | undefined;

  constructor(
    private readonly format: ProviderResponseFormat,
    private readonly onUsage: (tokens: number) => void,
  ) {}

  observe(payload: unknown): void {
    const data = object(payload);
    if (!data) return;
    if (this.format === "openai") {
      const usage = object(data.usage);
      if (!usage) return;
      const count = tokenCount(usage.total_tokens) ?? sumKnown(
        tokenCount(usage.prompt_tokens),
        tokenCount(usage.completion_tokens),
      );
      if (count && count > 0) this.onUsage(count);
      return;
    }
    if (this.format === "gemini") {
      const usage = object(data.usageMetadata);
      if (!usage) return;
      const count = tokenCount(usage.totalTokenCount) ?? sumKnown(
        tokenCount(usage.promptTokenCount),
        tokenCount(usage.candidatesTokenCount),
      );
      if (count && count > 0) this.onUsage(count);
      return;
    }

    const usage = object(data.usage) ?? object(object(data.message)?.usage);
    if (!usage) return;
    const input = tokenCount(usage.input_tokens);
    const output = tokenCount(usage.output_tokens);
    if (input !== undefined) {
      const cacheWrite = tokenCount(usage.cache_creation_input_tokens) ?? 0;
      const cacheRead = tokenCount(usage.cache_read_input_tokens) ?? 0;
      this.anthropicInput = sumKnown(input, cacheWrite, cacheRead);
    }
    if (output !== undefined) this.anthropicOutput = output;
    // message_start contains a preliminary output count; wait for the final delta.
    if (data.type === "message_start") return;
    if (data.type && data.type !== "message_delta" && data.type !== "message_stop") return;
    const count = sumKnown(this.anthropicInput, this.anthropicOutput);
    if (count) this.onUsage(count);
  }
}
