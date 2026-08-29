import { describe, expect, it, vi } from "vitest";

import { withOperationDeadline } from "../src/deadline";

describe("operation deadlines", () => {
  it("does not start external effect after parent deadline already aborted", async () => {
    const parent = new AbortController();
    parent.abort();
    const operation = vi.fn(() => Promise.resolve("unexpected"));

    await expect(withOperationDeadline(operation, 15_000, parent.signal)).rejects.toThrow(
      "External operation deadline exceeded",
    );
    expect(operation).not.toHaveBeenCalled();
  });
});
