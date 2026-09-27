import type { ApiKeyProviderId, ModelProviderId } from "./providers";

export type OptimizationMode = "user" | "system" | "iterate";
export type OptimizationEngine = "direct" | "prompt-optimizer-mcp";
export type ThemePreference = "system" | "light" | "dark";

export interface OptimizeRequest {
  requestId: string;
  mode: OptimizationMode;
  prompt: string;
  requirements?: string;
}

export type OptimizationEvent =
  | { requestId: string; type: "chunk"; content: string }
  | { requestId: string; type: "complete"; content: string }
  | { requestId: string; type: "history-warning"; message: string }
  | { requestId: string; type: "error"; message: string };

export interface PromptHistoryRecord {
  id: string;
  originalPrompt: string;
  optimizedPrompt: string;
  optimizedAt: number;
  mode: OptimizationMode;
  requirements?: string;
  routeName: string;
  model: string;
  engine: OptimizationEngine;
}

export interface ModelRoute {
  id: string;
  name: string;
  engine: OptimizationEngine;
  provider: ModelProviderId;
  baseUrl: string;
  apiHost: string;
  confirmedApiHost?: string;
  mcpUrl: string;
  mcpHost: string;
  confirmedMcpHost?: string;
  model: string;
  hasCredential: boolean;
  credentialNeedsReentry: boolean;
}

export interface RouteInput {
  id?: string;
  name: string;
  engine: OptimizationEngine;
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  credential?: string;
  clearCredential?: boolean;
  confirmedApiHost?: string;
  mcpUrl: string;
  confirmedMcpHost?: string;
}

export interface PublicSettings {
  activeRouteId: string;
  routes: ModelRoute[];
  apiKeyOnboardingCompleted: boolean;
  maxRequestsPerHour: number;
  dailyTokenBudget: number;
  maxOutputTokens: number;
  theme: ThemePreference;
}

export interface ApiKeySetupInput {
  provider: ApiKeyProviderId;
  credential: string;
  confirmedApiHost: string;
}

export interface SettingsInput {
  route: RouteInput;
  maxRequestsPerHour: number;
  dailyTokenBudget: number;
  maxOutputTokens: number;
}

export interface ModelDiscoveryResult {
  models: string[];
  source: "live" | "fallback";
  message: string;
}

export interface RouteTiming {
  dnsMs?: number;
  tcpMs?: number;
  tlsMs?: number;
  sendMs: number;
  firstByteMs?: number;
  firstResponseMs?: number;
  totalMs: number;
  mcpHandshakeMs?: number;
  toolDiscoveryMs?: number;
  modelProbeMs?: number;
}

export interface RouteTestResult {
  ok: boolean;
  host: string;
  message: string;
  timing: RouteTiming;
  quality: "excellent" | "good" | "moderate" | "high";
}

export interface BudgetStatus {
  date: string;
  requestsThisHour: number;
  maxRequestsPerHour: number;
  reservedTokensToday: number;
  dailyTokenBudget: number;
}

export interface DiagnosticsEvent {
  timestamp: string;
  level: "info" | "warning" | "error";
  code: string;
  details: Record<string, unknown>;
}

export interface DiagnosticsReport {
  generatedAt: string;
  application: {
    version: string;
    electronVersion: string;
    nodeVersion: string;
    packaged: boolean;
  };
  system: {
    platform: string;
    release: string;
    architecture: string;
    online: boolean;
  };
  activeRoute: {
    engine: OptimizationEngine;
    provider: ModelProviderId;
    model: string;
    host: string;
    proxy: string;
  } | null;
  window: {
    bounds: { x: number; y: number; width: number; height: number };
    maximized: boolean;
    minimized: boolean;
    alwaysOnTop: boolean;
  } | null;
  displays: Array<{
    id: number;
    label: string;
    scaleFactor: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  recentEvents: DiagnosticsEvent[];
}

export interface DiagnosticsExportResult {
  saved: boolean;
  fileName?: string;
}

export interface PromptFloatApi {
  getSettings: () => Promise<PublicSettings>;
  setTheme: (theme: ThemePreference) => Promise<PublicSettings>;
  saveProviderApiKey: (input: ApiKeySetupInput) => Promise<PublicSettings>;
  openProviderApiKeyPage: (provider: ApiKeyProviderId) => Promise<void>;
  saveSettings: (settings: SettingsInput) => Promise<PublicSettings>;
  activateRoute: (routeId: string) => Promise<PublicSettings>;
  deleteRoute: (routeId: string) => Promise<PublicSettings>;
  discoverModels: (route: RouteInput) => Promise<ModelDiscoveryResult>;
  testRoute: (settings: SettingsInput) => Promise<RouteTestResult>;
  getBudgetStatus: () => Promise<BudgetStatus>;
  listHistory: () => Promise<PromptHistoryRecord[]>;
  getDiagnostics: () => Promise<DiagnosticsReport>;
  exportDiagnostics: () => Promise<DiagnosticsExportResult>;
  optimize: (request: OptimizeRequest) => Promise<string>;
  cancelOptimization: (requestId: string) => void;
  onOptimizationEvent: (
    callback: (event: OptimizationEvent) => void,
  ) => () => void;
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
}
