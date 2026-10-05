import { describe, expect, it } from "vitest";

import type { InboxGroup, InboxItem } from "@/features/inbox/models/inboxPresentation";

import {
  arrivalBuckets,
  capturedToday,
  glanceCounts,
  glanceGreeting,
  glanceSummary,
} from "./glancePresentation";

const NOW = new Date("2026-10-04T14:30:00");

function capture(occurredAt: string, group: InboxGroup = "filed"): InboxItem {
  return {
    appLabel: "WhatsApp",
    category: undefined,
    confidence: undefined,
    content: undefined,
    evidence: [],
    factValues: {},
    group,
    id: occurredAt,
    kind: "fact",
    occurredAt,
    processing: "processed",
    retention: { rawExpired: false, rawExpiresAt: undefined },
    reviewReasons: [],
    scheduledAt: undefined,
    searchText: "",
    source: {
      applicationId: "com.whatsapp",
      kind: "notification",
      occurredAt,
      sender: undefined,
      subject: undefined,
      threadId: undefined,
    },
    sourceItemId: occurredAt,
    summary: undefined,
    threadKey: undefined,
    title: "A capture",
  };
}

describe("capturedToday", () => {
  it("keeps only the reader's own calendar day", () => {
    const items = [
      capture("2026-10-04T09:00:00"),
      capture("2026-10-03T23:59:00"),
      capture("2026-10-05T00:01:00"),
    ];
    expect(capturedToday(items, NOW)).toHaveLength(1);
  });

  it("drops a capture whose timestamp cannot be read rather than counting it as now", () => {
    expect(capturedToday([capture("not-a-date")], NOW)).toHaveLength(0);
  });
});

describe("glanceCounts", () => {
  it("counts today's outcomes and takes waiting from the proposals, not the group", () => {
    const items = [
      capture("2026-10-04T08:00:00", "filed"),
      capture("2026-10-04T09:00:00", "filed"),
      capture("2026-10-04T10:00:00", "needs-review"),
      capture("2026-10-04T11:00:00", "actionable"),
      capture("2026-10-03T11:00:00", "filed"),
    ];
    expect(glanceCounts(items, 1, NOW)).toEqual({
      captured: 4,
      filed: 2,
      review: 1,
      waiting: 1,
    });
  });
});

describe("arrivalBuckets", () => {
  it("buckets today's arrivals by local hour", () => {
    const buckets = arrivalBuckets(
      [
        capture("2026-10-04T09:10:00"),
        capture("2026-10-04T09:50:00"),
        capture("2026-10-04T13:00:00"),
        capture("2026-10-03T09:00:00"),
      ],
      NOW,
    );
    expect(buckets).toHaveLength(24);
    expect(buckets[9]).toBe(2);
    expect(buckets[13]).toBe(1);
    expect(buckets.reduce((total, count) => total + count, 0)).toBe(3);
  });
});

describe("glanceSummary", () => {
  it("leads with the quiet when nothing is waiting", () => {
    expect(glanceSummary({ captured: 12, filed: 10, review: 0, waiting: 0 })).toBe(
      "12 arrived. None of it needed you.",
    );
  });

  it("names how many decisions are open, in the right number", () => {
    expect(glanceSummary({ captured: 12, filed: 10, review: 0, waiting: 1 })).toBe(
      "11 handled quietly. 1 decision is waiting on you.",
    );
    expect(glanceSummary({ captured: 12, filed: 9, review: 0, waiting: 2 })).toBe(
      "10 handled quietly. 2 decisions are waiting on you.",
    );
  });

  it("does not claim a quiet day before anything has arrived", () => {
    expect(glanceSummary({ captured: 0, filed: 0, review: 0, waiting: 0 })).toBe(
      "Nothing has arrived yet today.",
    );
  });
});

describe("glanceGreeting", () => {
  it("follows the reader's own clock", () => {
    expect(glanceGreeting(new Date("2026-10-04T08:00:00"))).toBe("Good morning");
    expect(glanceGreeting(new Date("2026-10-04T13:00:00"))).toBe("Good afternoon");
    expect(glanceGreeting(new Date("2026-10-04T20:00:00"))).toBe("Good evening");
  });
});
