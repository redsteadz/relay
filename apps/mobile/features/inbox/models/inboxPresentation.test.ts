import { describe, expect, it } from "vitest";

import {
  appLabelFor,
  evidenceLabel,
  filterInbox,
  groupByApp,
  inboxItemForEvent,
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
      sender: undefined,
      subject: undefined,
    },
    ...overrides,
  };
}

function event(overrides: Partial<InboxEventInput> = {}): InboxEventInput {
  return {
    confidence: 0.75,
    createdAt: "2026-08-30T21:00:00.000Z",
    dateAmbiguity: null,
    dueAt: null,
    id: "11111111-1111-4111-8111-111111111111",
    kind: "fact",
    requiresReview: true,
    sourceItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    startsAt: null,
    summary: "Structured source facts available.",
    temporalStatus: "none",
    title: "Source fact",
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

const item = (
  o: Partial<InboxEventInput> = {},
  c = context(),
  facts: InboxFactInput[] = [fact()],
) => inboxItemForEvent(event(o), c, facts);

describe("inbox grouping", () => {
  it("files an unautomatable but unambiguous event quietly", () => {
    // `requiresReview` means "below the automation threshold", which most captures are. Promoting
    // those would bury the few items that genuinely need attention.
    const quiet = item();
    expect(quiet.group).toBe("quiet");
    expect(quiet.reviewReasons).toEqual([]);
    expect(quiet.confidence).toBe(0.75);
  });

  it("treats a scheduled event as actionable", () => {
    const scheduled = item({ kind: "task", startsAt: "2026-09-01T09:00:00.000Z" });
    expect(scheduled.group).toBe("actionable");
    expect(scheduled.scheduledAt).toBe("2026-09-01T09:00:00.000Z");
  });

  it("reviews a contradictory date even when a schedule exists", () => {
    const ambiguous = item({
      dateAmbiguity: "contradictory",
      startsAt: "2026-09-01T09:00:00.000Z",
      temporalStatus: "ambiguous",
    });
    expect(ambiguous.group).toBe("needs-review");
    expect(ambiguous.reviewReasons).toEqual(["Relay read conflicting values for this."]);
  });

  it("reviews an event whose supporting evidence is uncertain", () => {
    const uncertain = item({}, context(), [
      fact({ certainty: "uncertain", uncertaintyReason: "invalid" }),
    ]);
    expect(uncertain.group).toBe("needs-review");
    expect(uncertain.reviewReasons).toEqual(["The value Relay read is not a valid one."]);
  });

  it("falls back to the due date when an event has no start", () => {
    expect(item({ dueAt: "2026-09-02T10:00:00.000Z" }).scheduledAt).toBe(
      "2026-09-02T10:00:00.000Z",
    );
  });
});

describe("evidence", () => {
  it("carries supporting facts onto the event rather than listing them separately", () => {
    const withEvidence = item({}, context(), [fact(), fact({ kind: "currency", value: "USD" })]);
    expect(withEvidence.evidence).toEqual([
      { certain: true, kind: "amount", label: "42.50" },
      { certain: true, kind: "currency", label: "USD" },
    ]);
  });

  it("renders a date fact as its instant and role rather than its kind", () => {
    expect(evidenceLabel("date", { instant: "2026-08-31T07:59:23.966Z", role: "occurred" })).toBe(
      "occurred 2026-08-31T07:59:23.966Z",
    );
  });

  it("renders a bare string value directly", () => {
    expect(evidenceLabel("sender", "Example Bank")).toBe("Example Bank");
  });

  it("names the kind when a value has no displayable form", () => {
    expect(evidenceLabel("reference", { nested: { deep: true } })).toBe("reference");
  });
});

describe("application labels", () => {
  it("names a known capturing application", () => {
    expect(appLabelFor(context().source)).toBe("Gmail");
    expect(appLabelFor({ ...context().source, applicationId: "com.whatsapp" })).toBe("WhatsApp");
  });

  it("shows an exact package rather than guessing at an unknown application", () => {
    expect(appLabelFor({ ...context().source, applicationId: "com.example.bank" })).toBe(
      "com.example.bank",
    );
  });

  it("falls back to the source kind when no application was recorded", () => {
    expect(appLabelFor({ ...context().source, applicationId: undefined })).toBe(
      "Android notification",
    );
  });
});

describe("quiet grouping", () => {
  it("collapses quiet items by application, busiest first", () => {
    const gmail = context();
    const whatsapp = context({ source: { ...context().source, applicationId: "com.whatsapp" } });
    const groups = groupByApp([
      item({ id: "a" }, gmail),
      item({ id: "b" }, whatsapp),
      item({ id: "c" }, gmail),
    ]);

    expect(groups.map((group) => [group.appLabel, group.items.length])).toEqual([
      ["Gmail", 2],
      ["WhatsApp", 1],
    ]);
  });

  it("keeps every item present so nothing is hidden by collapsing", () => {
    const groups = groupByApp([item({ id: "a" }), item({ id: "b" })]);
    expect(groups.flatMap((group) => group.items)).toHaveLength(2);
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
    expect(filterInbox([item(), item({ id: "b" })], "   ")).toHaveLength(2);
  });

  it("matches the capturing application by name and by package", () => {
    expect(filterInbox([item()], "gmail")).toHaveLength(1);
    expect(filterInbox([item()], "com.google.android.gm")).toHaveLength(1);
  });

  it("reaches evidence so a fact stays findable without being its own row", () => {
    expect(filterInbox([item()], "42.50")).toHaveLength(1);
  });

  it("matches the category a filter decision assigned", () => {
    expect(filterInbox([item()], "finance")).toHaveLength(1);
  });

  it("narrows rather than widens as terms are added", () => {
    expect(filterInbox([item()], "source finance")).toHaveLength(1);
    expect(filterInbox([item()], "source unrelated")).toHaveLength(0);
  });

  it("ignores case", () => {
    expect(filterInbox([item()], "SOURCE FACT")).toHaveLength(1);
  });
});

describe("inbox sections", () => {
  it("ranks review above actionable above quiet and hides nothing", () => {
    const items = [
      item({ id: "quiet" }),
      item({ id: "actionable", startsAt: "2026-09-01T09:00:00.000Z" }),
      item({ dateAmbiguity: "invalid", id: "review" }),
    ];

    const sections = inboxSections(items);

    expect(sections.map((section) => section.group)).toEqual([
      "needs-review",
      "actionable",
      "quiet",
    ]);
    expect(sections.flatMap((section) => section.items)).toHaveLength(items.length);
    expect(sections[0]?.items[0]?.id).toBe("review");
  });

  it("reads actionable work forwards in time", () => {
    const sections = inboxSections([
      item({ id: "later", startsAt: "2026-09-05T09:00:00.000Z" }),
      item({ id: "sooner", startsAt: "2026-09-01T09:00:00.000Z" }),
    ]);

    expect(sections[1]?.items.map((entry) => entry.id)).toEqual(["sooner", "later"]);
  });

  it("reads quiet items newest first", () => {
    const sections = inboxSections([
      item({ createdAt: "2026-08-01T00:00:00.000Z", id: "older" }),
      item({ createdAt: "2026-08-30T00:00:00.000Z", id: "newer" }),
    ]);

    expect(sections[2]?.items.map((entry) => entry.id)).toEqual(["newer", "older"]);
  });

  it("returns empty sections so a screen can say a group is genuinely clear", () => {
    const sections = inboxSections([]);
    expect(sections).toHaveLength(3);
    expect(sections.every((section) => section.items.length === 0)).toBe(true);
  });
});
