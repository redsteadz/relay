import { describe, expect, it, vi } from "vitest";
import { finishCaptureSignOut } from "./capture-logout";
import { captureWorkAllowed, resumeCaptureWork, serializeCaptureWork } from "./capture-work";

function fixture(pending: number) {
  return {
    prepare: vi.fn().mockResolvedValue(undefined),
    finishCaptures: vi
      .fn()
      .mockImplementation((_tenant: string, discard: boolean) =>
        Promise.resolve(discard ? 0 : pending),
      ),
    clearDerived: vi.fn().mockResolvedValue(undefined),
    clearCaches: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
  };
}

describe("capture-safe logout", () => {
  it("requires explicit consent before discarding any unsynchronized captures", async () => {
    const ops = fixture(2);
    expect(await finishCaptureSignOut("account-a", false, ops)).toBe(2);
    expect(ops.clearDerived).not.toHaveBeenCalled();
    expect(ops.clearSession).not.toHaveBeenCalled();
    expect(captureWorkAllowed("account-a")).toBe(true);
    // Cancel is no operation: nothing has been cleared. Explicit discard completes the same flow.
    expect(await finishCaptureSignOut("account-a", true, ops)).toBe(0);
    expect(ops.finishCaptures).toHaveBeenLastCalledWith("account-a", true);
    expect(ops.clearDerived).toHaveBeenCalledWith("account-a");
    expect(ops.clearSession).toHaveBeenCalledOnce();
    expect(captureWorkAllowed("account-a")).toBe(false);
    expect(captureWorkAllowed("account-b")).toBe(true);
    resumeCaptureWork("account-a");
  });

  it("waits for active delivery and blocks a queued stale delivery before clearing", async () => {
    const ops = fixture(0);
    let release!: () => void;
    const active = serializeCaptureWork(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const logout = finishCaptureSignOut("account-a", false, ops);
    const upload = vi.fn();
    const stale = serializeCaptureWork(() => {
      if (captureWorkAllowed("account-a")) upload();
      return Promise.resolve();
    });
    expect(ops.clearSession).not.toHaveBeenCalled();
    release();
    await Promise.all([active, logout, stale]);
    expect(upload).not.toHaveBeenCalled();
    expect(ops.clearDerived.mock.invocationCallOrder[0]).toBeLessThan(
      ops.clearSession.mock.invocationCallOrder[0],
    );
    resumeCaptureWork("account-a");
  });

  it("keeps the session when queue inspection fails rather than assuming zero pending", async () => {
    const ops = fixture(0);
    ops.finishCaptures.mockRejectedValue(new Error("synthetic unavailable"));
    await expect(finishCaptureSignOut("account-a", false, ops)).rejects.toThrow();
    expect(ops.clearSession).not.toHaveBeenCalled();
    expect(ops.clearDerived).not.toHaveBeenCalled();
    expect(captureWorkAllowed("account-a")).toBe(true);
  });
});
