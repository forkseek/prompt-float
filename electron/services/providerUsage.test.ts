import { describe, expect, it } from "vitest";
import { ProviderUsageCollector } from "./providerUsage";

describe("provider-reported token usage", () => {
  it("accepts a final OpenAI usage event without text choices", () => {
    const seen: number[] = [];
    const collector = new ProviderUsageCollector("openai", (tokens) => seen.push(tokens));
    collector.observe({ choices: [], usage: { total_tokens: 53 } });
    expect(seen).toEqual([53]);
  });

  it("combines Anthropic start and final delta, including cached input", () => {
    const seen: number[] = [];
    const collector = new ProviderUsageCollector("anthropic", (tokens) => seen.push(tokens));
    collector.observe({ type: "message_start", message: { usage: {
      input_tokens: 20,
      cache_read_input_tokens: 5,
      output_tokens: 0,
    } } });
    expect(seen).toEqual([]);
    collector.observe({ type: "message_delta", usage: { output_tokens: 9 } });
    expect(seen).toEqual([34]);
  });

  it("accepts Gemini totals and ignores incomplete or unsafe numbers", () => {
    const seen: number[] = [];
    const collector = new ProviderUsageCollector("gemini", (tokens) => seen.push(tokens));
    collector.observe({ usageMetadata: { promptTokenCount: 12 } });
    collector.observe({ usageMetadata: { totalTokenCount: Number.MAX_SAFE_INTEGER + 1 } });
    collector.observe({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 } });
    expect(seen).toEqual([20]);
  });
});
