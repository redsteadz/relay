import { describe, expect, it } from "vitest";

import {
  inboxItemForEvent,
  inboxItemForFact,
  inboxSections,
  type InboxEventInput,
  type InboxFactInput,
} from "./inboxPresentation";

function event(overrides: Partial<InboxEventInput> = {}): InboxEventInput {
  return {
    confidence: 0.9,
    createdAt: "2026-08-30T21:00:00.000Z",
    dateAmbiguity: null,
    dueAt: null,
    id: "11111111-1111-4111-8111-111111111111",
    kind: "task",
    requiresReview: false,
    sourceItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    startsAt: "2026-09-01T09:00:00.000Z",
    summary: "Summary",
    temporalStatus: "resolved",
    title: "Review the statement",
    ...overrides,
  };
}

function fact(overrides: Partial<InboxFactInput> = {}): InboxFactInput {
  return {
    certainty: "certain",
    createdAt: "2026-08-30T21:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
    kind: "amount",
    sourceItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    uncertaintyReason: null,
    value: "42.50",
    ...overrides,
  };
}

describe("inbox grouping", () => {
  it("treats a confidently scheduled event as actionable", () => {
    const item = inboxItemForEvent(event());
    expect(item.group).toBe("actionable");
    expect(item.scheduledAt).toBe("2026-09-01T09:00:00.000Z");
    expect(item.reviewReasons).toEqual([]);
  });

  it("keeps an ambiguous date reviewable rather than actionable", () => {
    const item = inboxItemForEvent(
      event({ dateAmbiguity: "contradictory", temporalStatus: "ambiguous" }),
    );
    expect(item.group).toBe("needs-review");
    expect(item.reviewReasons).toEqual(["Relay read conflicting values for this."]);
  });

  it("reviews a low-confidence event instead of acting on it", () => {
    const item = inboxItemForEvent(event({ confidence: 0.2 }));
    expect(item.group).toBe("needs-review");
    expect(item.reviewReasons).toEqual(["Relay is not confident in this reading."]);
  });

  it("explains an extractor review flag when nothing more specific applies", () => {
    const item = inboxItemForEvent(event({ requiresReview: true }));
    expect(item.group).toBe("needs-review");
    expect(item.reviewReasons).toEqual(["Relay flagged this for review."]);
  });

  it("prefers the specific reason over the generic review flag", () => {
    const item = inboxItemForEvent(event({ dateAmbiguity: "invalid", requiresReview: true }));
    expect(item.reviewReasons).toEqual(["The value Relay read is not a valid one."]);
  });

  it("quiets an event that carries no schedule", () => {
    const item = inboxItemForEvent(event({ dueAt: null, startsAt: null }));
    expect(item.group).toBe("quiet");
    expect(item.scheduledAt).toBeUndefined();
  });

  it("falls back to the due date when an event has no start", () => {
    const item = inboxItemForEvent(event({ dueAt: "2026-09-02T10:00:00.000Z", startsAt: null }));
    expect(item.scheduledAt).toBe("2026-09-02T10:00:00.000Z");
  });
});

describe("fact grouping", () => {
  it("keeps a certain fact quiet and readable", () => {
    const item = inboxItemForFact(fact());
    expect(item.group).toBe("quiet");
    expect(item.title).toBe("42.50");
    expect(item.reviewReasons).toEqual([]);
  });

  it("surfaces an uncertain fact for review with its reason", () => {
    const item = inboxItemForFact(
      fact({ certainty: "uncertain", uncertaintyReason: "contradictory" }),
    );
    expect(item.group).toBe("needs-review");
    expect(item.reviewReasons).toEqual(["Relay read conflicting values for this."]);
  });

  it("names the fact kind when its value is not displayable text", () => {
    expect(inboxItemForFact(fact({ value: { raw: 1 } })).title).toBe("amount");
  });
});

describe("inbox sections", () => {
  it("ranks review above actionable above quiet and hides nothing", () => {
    const items = [
      inboxItemForFact(fact({ id: "quiet-fact" })),
      inboxItemForEvent(event({ id: "actionable" })),
      inboxItemForEvent(event({ dateAmbiguity: "invalid", id: "review" })),
    ];

    const sections = inboxSections(items);

    expect(sections.map((section) => section.group)).toEqual([
      "needs-review",
      "actionable",
      "quiet",
    ]);
    expect(sections.flatMap((section) => section.items).length).toBe(items.length);
    expect(sections[0]?.items[0]?.id).toBe("review");
  });

  it("reads actionable work forwards in time", () => {
    const sections = inboxSections([
      inboxItemForEvent(event({ id: "later", startsAt: "2026-09-05T09:00:00.000Z" })),
      inboxItemForEvent(event({ id: "sooner", startsAt: "2026-09-01T09:00:00.000Z" })),
    ]);

    expect(sections[1]?.items.map((item) => item.id)).toEqual(["sooner", "later"]);
  });

  it("reads unresolved and quiet items newest first", () => {
    const sections = inboxSections([
      inboxItemForFact(fact({ createdAt: "2026-08-01T00:00:00.000Z", id: "older" })),
      inboxItemForFact(fact({ createdAt: "2026-08-30T00:00:00.000Z", id: "newer" })),
    ]);

    expect(sections[2]?.items.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("returns empty sections so a screen can say a group is genuinely clear", () => {
    const sections = inboxSections([]);
    expect(sections).toHaveLength(3);
    expect(sections.every((section) => section.items.length === 0)).toBe(true);
  });
});
