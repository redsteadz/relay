import { afterEach, describe, expect, it, vi } from "vitest";

import { runInBackground } from "./observability";

describe("mobile background error safety", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a rejected fire-and-forget operation", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    runInBackground(Promise.reject(new Error("synthetic failure")), "background.synthetic_failed", {
      code: "SYNTHETIC_BACKGROUND_FAILED",
      integration: "synthetic",
      operation: "runSyntheticBackgroundWork",
    });

    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(JSON.parse(error.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "background.synthetic_failed",
      error: { code: "SYNTHETIC_BACKGROUND_FAILED" },
      level: "error",
    });
  });
});
