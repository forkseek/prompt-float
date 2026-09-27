import { describe, expect, it } from "vitest";
import { RequestRegistry } from "./requestRegistry";

describe("request registry", () => {
  it("allows only one active request per renderer", () => {
    const registry = new RequestRegistry();
    const active = registry.begin(7, crypto.randomUUID());
    expect(() => registry.begin(7, crypto.randomUUID())).toThrow(
      "已有优化请求正在运行",
    );
    registry.finish(7, active);
    expect(() => registry.begin(7, crypto.randomUUID())).not.toThrow();
  });

  it("only cancels the request owned by that renderer", () => {
    const registry = new RequestRegistry();
    const id = crypto.randomUUID();
    const active = registry.begin(1, id);
    expect(registry.cancel(2, id)).toBe(false);
    expect(active.controller.signal.aborted).toBe(false);
    expect(registry.cancel(1, id)).toBe(true);
    expect(active.controller.signal.aborted).toBe(true);
  });

  it("keeps ownership on stale finish and cancels all remaining requests", () => {
    const registry = new RequestRegistry();
    const first = registry.begin(11, crypto.randomUUID());
    const second = registry.begin(12, crypto.randomUUID());
    const stale = {
      ...first,
      controller: new AbortController(),
    };

    registry.finish(11, stale);
    expect(registry.get(11)).toBe(first);
    registry.cancelAll();
    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(true);
    expect(registry.get(11)).toBeUndefined();
  });
});
