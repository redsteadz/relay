import { describe, expect, it } from "vitest";

import {
  appIconFor,
  appLabelFor,
  formatCaptureTime,
  evidenceLabel,
  filterInbox,
  groupByApp,
  groupByThread,
  inboxItemForEvent,
  inboxRetention,
  inboxSections,
  inboxThreadKey,
  type InboxContext,
  type InboxEventInput,
  type InboxFactInput,
  type InboxSource,
} from "./inboxPresentation";

function context(overrides: Partial<InboxContext> = {}): InboxContext {
  return {
    category: { confidence: 0.8, method: "deterministic", name: "Finance", rationale: "Rule 3" },
    content: undefined,
    processing: "processed",
    retention: { rawExpired: false, rawExpiresAt: "2026-09-06T21:00:00.000Z" },
    source: {
      applicationId: "com.google.android.gm",
      kind: "notification",
      occurredAt: "2026-08-30T20:59:00.000Z",
      sender: undefined,
      subject: undefined,
      threadId: undefined,
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

describe("display text", () => {
  it("never shows the extractor's placeholder title", () => {
    expect(item().title).not.toBe("Source fact");
  });

  it("never shows the extractor's placeholder summary", () => {
    expect(item().summary).toBeUndefined();
  });

  it("names the sender when the capture said nothing readable", () => {
    const withSender = item({}, context(), [fact({ kind: "sender", value: "Alex" })]);
    expect(withSender.title).toBe("Alex");
  });

  it("falls back to the application when there is no sender either", () => {
    expect(item({}, context(), []).title).toBe("Gmail");
  });

  it("keeps a real extraction's own title and summary", () => {
    const extracted = item(
      { kind: "task", summary: "Amount: USD 14.20.", title: "USD 14.20 transaction" },
      context(),
      [],
    );
    expect(extracted.title).toBe("USD 14.20 transaction");
    expect(extracted.summary).toBe("Amount: USD 14.20.");
  });
});

describe("retained device content", () => {
  const said = context({ content: { body: "Your statement is ready", subject: "Example Bank" } });

  it("shows what the capture said instead of the extractor's fallback label", () => {
    const withContent = item({}, said);
    expect(withContent.title).toBe("Example Bank");
    expect(withContent.summary).toBe("Your statement is ready");
  });

  it("keeps a real extraction's own title ahead of the captured headline", () => {
    const extracted = item({ kind: "task", title: "USD 14.20 transaction" }, said);
    expect(extracted.title).toBe("USD 14.20 transaction");
  });

  it("prefers what the capture said over the sender", () => {
    const withBoth = inboxItemForEvent(event(), said, [fact({ kind: "sender", value: "Alex" })]);
    expect(withBoth.title).toBe("Example Bank");
  });

  it("searches what the capture said", () => {
    expect(filterInbox([item({}, said)], "statement is ready")).toHaveLength(1);
    expect(filterInbox([item({}, said)], "example bank")).toHaveLength(1);
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

describe("capture times", () => {
  // Built from local components so the expectations hold in any zone the suite runs in.
  const at = (y: number, m: number, d: number, hh: number, mm: number) => new Date(y, m, d, hh, mm);

  it("shows only the clock for a capture from today", () => {
    const now = at(2026, 7, 31, 18, 5);
    expect(formatCaptureTime(at(2026, 7, 31, 9, 7).toISOString(), now)).toBe("09:07");
  });

  it("adds the day for an older capture in the same year", () => {
    const now = at(2026, 7, 31, 18, 5);
    expect(formatCaptureTime(at(2026, 7, 24, 14, 30).toISOString(), now)).toBe("24 Aug, 14:30");
  });

  it("adds the year for a capture from another year", () => {
    const now = at(2026, 0, 2, 9, 0);
    expect(formatCaptureTime(at(2025, 11, 31, 23, 45).toISOString(), now)).toBe(
      "31 Dec 2025, 23:45",
    );
  });

  it("distinguishes the same clock time on a different day", () => {
    const now = at(2026, 7, 31, 18, 5);
    expect(formatCaptureTime(at(2026, 7, 30, 18, 5).toISOString(), now)).not.toBe("18:05");
  });

  it("returns nothing readable for an unparseable time rather than inventing one", () => {
    expect(formatCaptureTime("not-a-time")).toBe("");
  });
});

describe("application icons", () => {
  it("names an icon for a known application", () => {
    expect(appIconFor(context().source)).toBe("gmail");
    expect(appIconFor({ ...context().source, applicationId: "com.whatsapp" })).toBe("whatsapp");
  });

  it("falls back to the source icon for an unknown application", () => {
    expect(appIconFor({ ...context().source, applicationId: "com.example.bank" })).toBe(
      "bell-outline",
    );
  });

  it("marks a source that is no longer retained", () => {
    expect(appIconFor({ ...context().source, applicationId: undefined, kind: "unknown" })).toBe(
      "help-circle-outline",
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

describe("inboxThreadKey", () => {
  const source = (overrides: Partial<InboxSource> = {}): InboxSource => ({
    applicationId: "com.whatsapp",
    kind: "notification",
    occurredAt: "2026-09-01T09:00:00.000Z",
    sender: undefined,
    subject: undefined,
    threadId: undefined,
    ...overrides,
  });

  it("believes a provider's own thread id before anything inferred", () => {
    const key = inboxThreadKey(source({ kind: "gmail", subject: "Invoice", threadId: "t-1" }));
    expect(key).toBe("provider:gmail:t-1");
  });

  it("keeps one provider thread together even when the subject changes", () => {
    const first = inboxThreadKey(source({ kind: "gmail", subject: "Invoice", threadId: "t-1" }));
    const renamed = inboxThreadKey(
      source({ kind: "gmail", subject: "Re: budget", threadId: "t-1" }),
    );
    expect(first).toBe(renamed);
  });

  it("groups a conversation by the other party within one application", () => {
    const key = inboxThreadKey(source({ sender: "Alex Rivera" }));
    expect(key).toBe("sender:com.whatsapp:alex rivera");
  });

  it("normalizes spelling so one person is not split in two", () => {
    expect(inboxThreadKey(source({ sender: "Alex  RIVERA " }))).toBe(
      inboxThreadKey(source({ sender: "alex rivera" })),
    );
  });

  it("does not merge the same sender across different applications", () => {
    const whatsapp = inboxThreadKey(source({ sender: "Alex" }));
    const messages = inboxThreadKey(
      source({ applicationId: "com.google.android.apps.messaging", sender: "Alex" }),
    );
    expect(whatsapp).not.toBe(messages);
  });

  it("joins a reply to the subject it answers", () => {
    const original = inboxThreadKey(source({ kind: "email", subject: "Quarterly budget" }));
    const reply = inboxThreadKey(source({ kind: "email", subject: "Re: Quarterly budget" }));
    const forward = inboxThreadKey(source({ kind: "email", subject: "Fwd: Re: Quarterly budget" }));
    expect(reply).toBe(original);
    expect(forward).toBe(original);
  });

  it("returns nothing when the source identifies no conversation", () => {
    expect(inboxThreadKey(source())).toBeUndefined();
  });
});

describe("groupByThread", () => {
  it("collapses items that share a conversation, newest first", () => {
    const base = inboxItemForEvent(
      event({ id: "a", createdAt: "2026-09-01T09:00:00.000Z" }),
      context(),
    );
    const older = { ...base, id: "a", occurredAt: "2026-09-01T09:00:00.000Z", threadKey: "t" };
    const newer = { ...base, id: "b", occurredAt: "2026-09-02T09:00:00.000Z", threadKey: "t" };
    const [thread, ...rest] = groupByThread([older, newer]);
    expect(rest).toHaveLength(0);
    expect(thread?.items).toHaveLength(2);
    expect(thread?.latest.id).toBe("b");
  });

  it("keeps items without a conversation apart rather than pooling them", () => {
    const base = inboxItemForEvent(event({ id: "a" }), context());
    const first = { ...base, id: "a", threadKey: undefined };
    const second = { ...base, id: "b", threadKey: undefined };
    expect(groupByThread([first, second])).toHaveLength(2);
  });

  it("accounts for every item it was given", () => {
    const base = inboxItemForEvent(event({ id: "a" }), context());
    const items = [
      { ...base, id: "a", threadKey: "t" },
      { ...base, id: "b", threadKey: "t" },
      { ...base, id: "c", threadKey: undefined },
    ];
    const total = groupByThread(items).reduce((sum, thread) => sum + thread.items.length, 0);
    expect(total).toBe(items.length);
  });
});
