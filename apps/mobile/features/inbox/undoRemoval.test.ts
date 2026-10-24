import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability", () => ({ logMobileError: vi.fn() }));

import { logMobileError } from "@/lib/observability";

import { UNDO_FAILED_MESSAGE, undoRemoval } from "./undoRemoval";

describe("undoRemoval", () => {
  it("stays silent when the restore succeeds", async () => {
    const onFailed = vi.fn();
    undoRemoval(() => Promise.resolve(), "event-1", onFailed);
    await Promise.resolve();
    await Promise.resolve();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("logs once and reports the fixed message when the restore rejects", async () => {
    const cause = new Error("synthetic failure");
    const onFailed = vi.fn();
    undoRemoval(() => Promise.reject(cause), "event-1", onFailed);
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith(UNDO_FAILED_MESSAGE));
    expect(logMobileError).toHaveBeenCalledTimes(1);
    expect(logMobileError).toHaveBeenCalledWith(
      "ui.inbox_undo_failed",
      cause,
      expect.objectContaining({ code: "INBOX_UNDO_FAILED", operation: "restoreInboxEvent" }),
    );
  });
});
