import { afterEach, describe, expect, it, vi } from "vitest";

import { readBoundedJson } from "../src/bounded-json";

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded remote JSON", () => {
  it("applies one deadline to whole streaming body and cancels reader", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
          if (timer !== undefined) clearInterval(timer);
        },
        start(controller) {
          controller.enqueue(new TextEncoder().encode("["));
          timer = setInterval(() => controller.enqueue(new TextEncoder().encode("0,")), 100);
        },
      }),
    );

    const result = readBoundedJson(response, 1024, { timeoutMs: 500 });
    const rejection = expect(result).rejects.toMatchObject({ code: "response-unavailable" });
    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    expect(cancelled).toBe(true);
  });

  it("preserves deterministic size rejection", async () => {
    await expect(
      readBoundedJson(new Response("{}", { headers: { "content-length": "3" } }), 2),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });
});
