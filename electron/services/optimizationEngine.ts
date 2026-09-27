import type {
  OptimizationMode,
  RouteTestResult,
} from "../../shared/types";
import { testDirectRoute } from "./connectionTester";
import { optimizePrompt } from "./promptOptimizer";
import {
  optimizePromptWithMcp,
  testMcpRoute,
} from "./promptOptimizerMcp";
import { PublicError } from "./publicError";
import type { RuntimeSettings } from "./settingsStore";

interface OptimizeConfiguredOptions {
  mode: OptimizationMode;
  prompt: string;
  requirements?: string;
  settings: RuntimeSettings;
  signal: AbortSignal;
  onChunk: (chunk: string) => void;
  onUsage?: (tokens: number) => void;
}

export function testConfiguredRoute(
  settings: RuntimeSettings,
  signal: AbortSignal,
): Promise<RouteTestResult> {
  return settings.engine === "prompt-optimizer-mcp"
    ? testMcpRoute(settings, signal)
    : testDirectRoute(settings, signal);
}

export function optimizeConfiguredPrompt(
  options: OptimizeConfiguredOptions,
): Promise<string> {
  if (options.settings.engine === "prompt-optimizer-mcp") {
    return optimizePromptWithMcp(options);
  }
  if (options.mode === "iterate") {
    throw new PublicError("迭代优化仅支持 Prompt Optimizer MCP 引擎");
  }
  return optimizePrompt({
    ...options,
    mode: options.mode,
  });
}
