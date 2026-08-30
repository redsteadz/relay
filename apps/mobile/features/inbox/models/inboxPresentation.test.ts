import { describe, expect, it } from "vitest";

import {
  filterInbox,
  inboxItemForEvent,
  inboxItemForFact,
  inboxRetention,
  inboxSections,
  type InboxContext,
  type InboxEventInput,
  type InboxFactInput,
} from "./inboxPresentation";

function context(overrides: Partial<InboxContext> = {}): InboxContext {
  return {
    category: { confidence: 0.8, method: "deterministic", name: "Finance", rationale: "Rule 3" },
    processing: "processed",
    retention: { rawExpired: false, rawExpiresAt: "2026-09-06T21:00:00.000Z" },
    source: {
      applicationId: "com.google.android.gm",
      kind: "notification",
      occurredAt: "2026-08-30T20:59:00.000Z",
      sender: "billing@example.test",
      subject: "Statement ready",
    },
    ...overrides,
  };
}

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

const eventItem = (o: Partial<InboxEventInput> = {}, c = context()) =>
  inboxItemForEvent(event(o), c);
const factItem = (o: Partial<InboxFactInput> = {}, c = context()) => inboxItemForFact(fact(o), c);

describe("inbox grouping", () => {
  it("treats a confidently scheduled event as actionable", () => {
    const item = eventItem();
    expect(item.group).toBe("actionable");
    expect(item.scheduledAt).toBe("2026-09-01T09:00:00.000Z");
    expect(item.reviewReasons).toEqual([]);
  });

  it("keeps an ambiguous date reviewable rather than actionable", () => {
    const item = eventItem({ dateAmbiguity: "contradictory", temporalStatus: "ambiguous" });
    expect(item.group).toBe("needs-review");
    expect(item.reviewReasons).toEqual(["Relay read conflicting values for this."]);
  });

  it("reviews a low-confidence event instead of acting on it", () => {
    const item = eventItem({ confidence: 0.2 });
    expect(item.group).toBe("needs-review");
    expect(item.reviewReasons).toEqual(["Relay is not confident in this reading."]);
  });

  it("explains an extractor review flag when nothing more specific applies", () => {
    expect(eventItem({ requiresReview: true }).reviewReasons).toEqual([
      "Relay flagged this for review.",
    ]);
  });

  it("prefers the specific reason over the generic review flag", () => {
    expect(eventItem({ dateAmbiguity: "invalid", requiresReview: true }).reviewReasons).toEqual([
      "The value Relay read is not a valid one.",
    ]);
  });

  it("quiets an event that carries no schedule", () => {
    const item = eventItem({ dueAt: null, startsAt: null });
    expect(item.group).toBe("quiet");
    expect(item.scheduledAt).toBeUndefined();
  });

  it("falls back to the due date when an event has no start", () => {
    expect(eventItem({ dueAt: "2026-09-02T10:00:00.000Z", startsAt: null }).scheduledAt).toBe(
      "2026-09-02T10:00:00.000Z",
    );
  });
});

describe("fact grouping", () => {
  it("keeps a certain fact quiet and readable", () => {
    const item = factItem();
    expect(item.group).toBe("quiet");
    expect(item.title).toBe("42.50");
  });

  it("surfaces an uncertain fact for review with its reason", () => {
    const item = factItem({ certainty: "uncertain", uncertaintyReason: "contradictory" });
    expect(item.group).toBe("needs-review");
    expect(item.reviewReasons).toEqual(["Relay read conflicting values for this."]);
  });

  it("names the fact kind when its value is not displayable text", () => {
    expect(factItem({ value: { raw: 1 } }).title).toBe("amount");
  });
});

describe("item context", () => {
  it("carries source, category, retention, and processing onto the item", () => {
    const item = eventItem();
    expect(item.source.kind).toBe("notification");
    expect(item.source.applicationId).toBe("com.google.android.gm");
    expect(item.category?.method).toBe("deterministic");
    expect(item.category?.name).toBe("Finance");
    expect(item.retention.rawExpired).toBe(false);
    expect(item.processing).toBe("processed");
  });

  it("reports an unfinished capture as pending rather than failed", () => {
    expect(eventItem({}, context({ processing: "pending" })).processing).toBe("pending");
  });

  it("marks an item whose raw payload has expired", () => {
    const expired = context({
      retention: { rawExpired: true, rawExpiresAt: "2026-08-01T00:00:00.000Z" },
    });
    expect(eventItem({}, expired).retention.rawExpired).toBe(true);
  });
});

describe("raw retention", () => {
  it("expires a raw payload once its deadline has passed", () => {
    expect(inboxRetention("2026-08-01T00:00:00.000Z", "2026-08-30T00:00:00.000Z").rawExpired).toBe(
      true,
    );
  });

  it("keeps a raw payload live before its deadline", () => {
    expect(inboxRetention("2026-09-06T00:00:00.000Z", "2026-08-30T00:00:00.000Z").rawExpired).toBe(
      false,
    );
  });

  it("treats an absent deadline as nothing to expire", () => {
    expect(inboxRetention(null, "2026-08-30T00:00:00.000Z")).toEqual({
      rawExpired: false,
      rawExpiresAt: undefined,
    });
  });
});

describe("inbox search", () => {
  it("returns everything for a blank query", () => {
    expect(filterInbox([eventItem(), factItem()], "   ")).toHaveLength(2);
  });

  it("matches derived title text", () => {
    // Both items share a source subject, so search on the event title itself rather than on
    // metadata the fact also carries.
    expect(filterInbox([eventItem(), factItem()], "review the")).toHaveLength(1);
  });

  it("matches retained source metadata", () => {
    expect(filterInbox([eventItem()], "android.gm")).toHaveLength(1);
    expect(filterInbox([eventItem()], "billing@example.test")).toHaveLength(1);
  });

  it("matches the category a filter decision assigned", () => {
    expect(filterInbox([eventItem()], "finance")).toHaveLength(1);
  });

  it("narrows rather than widens as terms are added", () => {
    expect(filterInbox([eventItem()], "statement finance")).toHaveLength(1);
    expect(filterInbox([eventItem()], "statement unrelated")).toHaveLength(0);
  });

  it("ignores case", () => {
    expect(filterInbox([eventItem()], "REVIEW THE STATEMENT")).toHaveLength(1);
  });
});

describe("inbox sections", () => {
  it("ranks review above actionable above quiet and hides nothing", () => {
    const items = [
      factItem({ id: "quiet-fact" }),
      eventItem({ id: "actionable" }),
      eventItem({ dateAmbiguity: "invalid", id: "review" }),
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
      eventItem({ id: "later", startsAt: "2026-09-05T09:00:00.000Z" }),
      eventItem({ id: "sooner", startsAt: "2026-09-01T09:00:00.000Z" }),
    ]);

    expect(sections[1]?.items.map((item) => item.id)).toEqual(["sooner", "later"]);
  });

  it("reads unresolved and quiet items newest first", () => {
    const sections = inboxSections([
      factItem({ createdAt: "2026-08-01T00:00:00.000Z", id: "older" }),
      factItem({ createdAt: "2026-08-30T00:00:00.000Z", id: "newer" }),
    ]);

    expect(sections[2]?.items.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("returns empty sections so a screen can say a group is genuinely clear", () => {
    const sections = inboxSections([]);
    expect(sections).toHaveLength(3);
    expect(sections.every((section) => section.items.length === 0)).toBe(true);
  });
});
