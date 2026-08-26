import { describe, expect, it } from "vitest";

import { SerialExecutor } from "../src/serialization";

describe("SerialExecutor", () => {
  it("does not start later tenant work while persistence is pending", async () => {
    const executor = new SerialExecutor();
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = executor.run(async () => {
      calls.push("first-start");
      await gate;
      calls.push("first-finish");
    });
    const second = executor.run(() => {
      calls.push("second-start");
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(calls).toEqual(["first-start"]);
    release?.();
    await Promise.all([first, second]);
    expect(calls).toEqual(["first-start", "first-finish", "second-start"]);
  });

  it("continues after failed tenant work", async () => {
    const executor = new SerialExecutor();
    const failed = executor.run(() => Promise.reject(new Error("synthetic failure")));
    const recovered = executor.run(() => Promise.resolve("recovered"));

    await expect(failed).rejects.toThrow("synthetic failure");
    await expect(recovered).resolves.toBe("recovered");
  });
});
