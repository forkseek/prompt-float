import { ipcMain, type BrowserWindow, type WebContents } from "electron";
import type { OptimizationEvent } from "../../shared/types";
import { appendHistory } from "../services/historyStore";
import { recordDiagnostic } from "../services/diagnostics";
import {
  optimizeConfiguredPrompt,
  testConfiguredRoute,
} from "../services/optimizationEngine";
import { PublicError, toPublicErrorMessage } from "../services/publicError";
import { RequestRegistry } from "../services/requestRegistry";
import { getRouteTestSettings, getRuntimeSettings } from "../services/settingsStore";
import {
  reserveOptimizationUsage,
  reserveRouteTestUsage,
  settleOptimizationUsage,
} from "../services/usageLimiter";
import type { UsageReservation } from "../services/usageRepository";
import type { SecureHandle } from "./secureHandle";
import {
  assertTrustedIpcSender,
  optimizeRequestSchema,
  parseIpcPayload,
  requestIdSchema,
  settingsInputSchema,
} from "./validation";

const requestRegistry = new RequestRegistry();

function sendEvent(sender: WebContents, event: OptimizationEvent): void {
  if (!sender.isDestroyed()) sender.send("optimizer:event", event);
}

export function registerOptimizationHandlers(
  handle: SecureHandle,
  getWindow: () => BrowserWindow | null,
  expectedRendererUrl: string,
): void {
  handle("routes:test", async (event, payload) => {
    const input = parseIpcPayload(settingsInputSchema, payload);
    const startedAt = Date.now();
    const active = requestRegistry.begin(event.sender.id, "route-test");
    const timeout = setTimeout(() => {
      active.timedOut = true;
      active.controller.abort();
    }, 40_000);
    let reservation: UsageReservation | undefined;
    try {
      const settings = await getRouteTestSettings(input);
      recordDiagnostic("info", "route_test.started", {
        routeId: settings.routeId,
        engine: settings.engine,
        provider: settings.provider,
        model: settings.model,
      });
      if (active.controller.signal.aborted) {
        throw new PublicError("路由测试已取消");
      }
      reservation = await reserveRouteTestUsage(settings);
      const result = await testConfiguredRoute(settings, active.controller.signal);
      recordDiagnostic("info", "route_test.completed", {
        routeId: settings.routeId,
        durationMs: Date.now() - startedAt,
        quality: result.quality,
        timing: result.timing,
      });
      return result;
    } catch (error) {
      recordDiagnostic("warning", "route_test.failed", {
        routeId: input.route.id || "new",
        durationMs: Date.now() - startedAt,
        aborted: active.controller.signal.aborted,
      });
      if (active.controller.signal.aborted) {
        throw new PublicError(active.timedOut ? "路由测试超时（40 秒）" : "路由测试已取消");
      }
      throw error;
    } finally {
      try {
        if (reservation) await settleOptimizationUsage(reservation);
      } finally {
        clearTimeout(timeout);
        requestRegistry.finish(event.sender.id, active);
      }
    }
  });

  handle("optimizer:optimize", async (event, payload) => {
    const request = parseIpcPayload(optimizeRequestSchema, payload);
    const startedAt = Date.now();
    const senderId = event.sender.id;
    const active = requestRegistry.begin(senderId, request.requestId);
    const timeout = setTimeout(() => {
      active.timedOut = true;
      active.controller.abort();
    }, 120_000);
    let reservation: UsageReservation | undefined;
    let reportedUsage: number | undefined;

    try {
      const settings = await getRuntimeSettings();
      recordDiagnostic("info", "optimization.started", {
        requestId: request.requestId,
        routeId: settings.routeId,
        engine: settings.engine,
        provider: settings.provider,
        model: settings.model,
      });
      reservation = await reserveOptimizationUsage(
        settings,
        request.requirements
          ? `${request.prompt}\n${request.requirements}`
          : request.prompt,
      );
      const result = await optimizeConfiguredPrompt({
        mode: request.mode,
        prompt: request.prompt,
        requirements: request.requirements,
        settings,
        signal: active.controller.signal,
        onUsage: (tokens) => { reportedUsage = tokens; },
        onChunk: (content) => sendEvent(event.sender, {
          requestId: request.requestId,
          type: "chunk",
          content,
        }),
      });
      await settleOptimizationUsage(reservation, reportedUsage);
      reservation = undefined;
      try {
        await appendHistory(request, result, settings);
      } catch {
        recordDiagnostic("warning", "history.save_failed", {
          requestId: request.requestId,
        });
        sendEvent(event.sender, {
          requestId: request.requestId,
          type: "history-warning",
          message: "优化已完成，但历史记录保存失败；请检查本机存储",
        });
      }
      recordDiagnostic("info", "optimization.completed", {
        requestId: request.requestId,
        routeId: settings.routeId,
        durationMs: Date.now() - startedAt,
        outputCharacters: result.length,
      });
      sendEvent(event.sender, {
        requestId: request.requestId,
        type: "complete",
        content: result,
      });
      return result;
    } catch (error) {
      const message = active.controller.signal.aborted
        ? active.timedOut ? "优化超时（120 秒）" : "优化已取消"
        : toPublicErrorMessage(error, "优化失败，请稍后重试");
      recordDiagnostic("warning", "optimization.failed", {
        requestId: request.requestId,
        durationMs: Date.now() - startedAt,
        aborted: active.controller.signal.aborted,
        message,
      });
      sendEvent(event.sender, { requestId: request.requestId, type: "error", message });
      throw new PublicError(message);
    } finally {
      if (reservation) {
        await settleOptimizationUsage(reservation).catch(() => {
          recordDiagnostic("error", "usage.settlement_failed", {
            requestId: request.requestId,
          });
        });
      }
      clearTimeout(timeout);
      requestRegistry.finish(senderId, active);
    }
  });

  ipcMain.on("optimizer:cancel", (event, payload) => {
    try {
      assertTrustedIpcSender(event, getWindow(), expectedRendererUrl);
      requestRegistry.cancel(event.sender.id, parseIpcPayload(requestIdSchema, payload));
    } catch {
      // Invalid fire-and-forget cancellation requests are ignored.
    }
  });
}

export function cancelAllRequests(): void {
  requestRegistry.cancelAll();
}
