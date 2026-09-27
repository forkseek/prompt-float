import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["electron/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "electron/infrastructure/jsonFile.ts",
        "electron/infrastructure/serialTaskQueue.ts",
        "electron/ipc/validation.ts",
        "electron/security/rendererNetwork.ts",
        "electron/security/rendererProtocolPolicy.ts",
        "electron/security/rendererTrust.ts",
        "electron/security/updateTrust.ts",
        "electron/services/connectionTester.ts",
        "electron/services/diagnosticSanitizer.ts",
        "electron/services/endpointPolicy.ts",
        "electron/services/historyRepository.ts",
        "electron/services/modelDiscovery.ts",
        "electron/services/promptOptimizer.ts",
        "electron/services/promptOptimizerMcp.ts",
        "electron/services/providerLinks.ts",
        "electron/services/responseLimits.ts",
        "electron/services/requestRegistry.ts",
        "electron/services/routeDiagnostics.ts",
        "electron/services/settingsRepository.ts",
        "electron/services/usageRepository.ts",
        "shared/securityPolicy.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
