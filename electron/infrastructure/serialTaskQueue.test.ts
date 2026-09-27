import { describe, expect, it } from "vitest";
import { SerialTaskQueue } from "./serialTaskQueue";

describe("serial task queue", () => {
  it("runs tasks in submission order", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = queue.run(async () => {
      events.push("second");
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("releases the next task after a failure", async () => {
    const queue = new SerialTaskQueue();
    await expect(
      queue.run(async () => {
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });
});
