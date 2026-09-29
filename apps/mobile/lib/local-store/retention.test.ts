import { describe, expect, it } from "vitest";

import {
  capturesToPrune,
  isLocalCaptureExpired,
  LOCAL_STORE_MAX_AGE_MS,
  LOCAL_STORE_MAX_CAPTURES,
  type PrunableCapture,
} from "./retention";

const now = Date.parse("2026-09-27T12:00:00Z");

function capture(id: string, offsetMs: number): PrunableCapture {
  return { capturedAt: new Date(now - offsetMs).toISOString(), sourceItemId: id };
}

const day = 24 * 60 * 60 * 1000;

describe("isLocalCaptureExpired", () => {
  it("keeps a capture inside the window", () => {
    expect(isLocalCaptureExpired(new Date(now - 29 * day).toISOString(), now)).toBe(false);
  });

  it("drops a capture exactly at the boundary", () => {
    expect(isLocalCaptureExpired(new Date(now - LOCAL_STORE_MAX_AGE_MS).toISOString(), now)).toBe(
      true,
    );
  });

  it("drops a capture whose timestamp cannot be read", () => {
    expect(isLocalCaptureExpired("not-a-date", now)).toBe(true);
  });
});

describe("capturesToPrune", () => {
  it("prunes nothing when everything is inside both bounds", () => {
    expect(capturesToPrune([capture("a", day), capture("b", 2 * day)], now)).toEqual([]);
  });

  it("prunes only what has aged out", () => {
    const captures = [capture("fresh", day), capture("stale", 31 * day)];
    expect(capturesToPrune(captures, now)).toEqual(["stale"]);
  });

  it("drops a capture whose timestamp cannot be read rather than retaining it forever", () => {
    const captures = [capture("fresh", day), { capturedAt: "", sourceItemId: "unreadable" }];
    expect(capturesToPrune(captures, now)).toEqual(["unreadable"]);
  });

  it("prunes the oldest surviving captures once the count bound is exceeded", () => {
    const captures = [
      capture("newest", day),
      capture("middle", 2 * day),
      capture("oldest", 3 * day),
    ];
    expect(capturesToPrune(captures, now, { maxCaptures: 1 })).toEqual(["oldest", "middle"]);
  });

  it("applies age before count, so an expired capture never evicts a live one", () => {
    // Two live captures and one expired, with room for two. Only the expired one goes: counting
    // first would have made the store look over budget and taken a capture still inside the window.
    const captures = [
      capture("live-a", day),
      capture("live-b", 2 * day),
      capture("gone", 40 * day),
    ];
    expect(capturesToPrune(captures, now, { maxCaptures: 2 })).toEqual(["gone"]);
  });

  it("breaks a timestamp tie by id so repeated sweeps evict the same row", () => {
    const tied = [capture("b", day), capture("a", day), capture("c", day)];
    const first = capturesToPrune(tied, now, { maxCaptures: 1 });
    const second = capturesToPrune([...tied].reverse(), now, { maxCaptures: 1 });
    expect(first).toEqual(["a", "b"]);
    expect(second).toEqual(first);
  });

  it("prunes nothing from an empty store", () => {
    expect(capturesToPrune([], now)).toEqual([]);
  });

  it("keeps a full store exactly at the count bound", () => {
    const captures = Array.from({ length: LOCAL_STORE_MAX_CAPTURES }, (_value, index) =>
      capture(`capture-${index}`, day),
    );
    expect(capturesToPrune(captures, now)).toEqual([]);
  });

  it("bounds match the native content store they are paired with", () => {
    // capture_content keeps thirty days and two thousand items; a derived row outliving the text it
    // describes would render an item whose body had gone.
    expect(LOCAL_STORE_MAX_AGE_MS).toBe(30 * day);
    expect(LOCAL_STORE_MAX_CAPTURES).toBe(2000);
  });
});
