import { describe, expect, it } from "vitest";

import {
  filterByCategory,
  summariseByCategory,
  UNFILED_CATEGORY_KEY,
  type InboxItem,
} from "./inboxPresentation";

const known = [
  { isSystem: false, name: "Finance", slug: "finance" },
  { isSystem: true, name: "Logistics", slug: "logistics" },
  { isSystem: false, name: "Empty", slug: "empty" },
];

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    appLabel: "Messages",
    category: undefined,
    confidence: undefined,
    content: undefined,
    evidence: [],
    factValues: {},
    group: "filed",
    id: "e1",
    kind: "fact",
    occurredAt: "2026-09-04T09:00:00.000Z",
    processing: "processed",
    retention: { rawExpired: false, rawExpiresAt: undefined },
    reviewReasons: [],
    scheduledAt: undefined,
    searchText: "",
    source: {
      applicationId: undefined,
      kind: "notification",
      occurredAt: "2026-09-04T09:00:00.000Z",
      sender: undefined,
      subject: undefined,
      threadId: undefined,
    },
    sourceItemId: "s1",
    summary: undefined,
    threadKey: undefined,
    title: "Something",
    ...overrides,
  };
}

function filed(name: string, overrides: Partial<InboxItem> = {}): InboxItem {
  return item({
    category: {
      confidence: 0.9,
      filterRuleId: undefined,
      method: "deterministic",
      name,
      origin: "server",
      rationale: undefined,
    },
    ...overrides,
  });
}

describe("summarising by category", () => {
  // A category a person created and cannot find is indistinguishable from one that was never
  // saved, which is the failure this listing exists to rule out.
  it("lists every category the tenant owns, including ones nothing matched", () => {
    const summaries = summariseByCategory([], known);
    expect(summaries.map((entry) => entry.name).sort()).toEqual(["Empty", "Finance", "Logistics"]);
    expect(summaries.every((entry) => entry.captures === 0)).toBe(true);
  });

  it("counts what is filed into each", () => {
    const summaries = summariseByCategory(
      [filed("Finance", { id: "a" }), filed("Finance", { id: "b" }), filed("Logistics")],
      known,
    );
    const byName = new Map(summaries.map((entry) => [entry.name, entry]));
    expect(byName.get("Finance")?.captures).toBe(2);
    expect(byName.get("Logistics")?.captures).toBe(1);
    expect(byName.get("Empty")?.captures).toBe(0);
  });

  it("counts what is still waiting apart from volume", () => {
    const summaries = summariseByCategory(
      [
        filed("Finance", { group: "actionable", id: "a" }),
        filed("Finance", { group: "needs-review", id: "b", reviewReasons: ["Conflicting."] }),
        filed("Finance", { group: "filed", id: "c" }),
      ],
      known,
    );
    const finance = summaries.find((entry) => entry.name === "Finance");
    expect(finance).toMatchObject({ actionable: 1, captures: 3, needsReview: 1 });
  });

  it("marks Relay's own vocabulary apart from what the tenant created", () => {
    const summaries = summariseByCategory([], known);
    expect(summaries.find((entry) => entry.name === "Logistics")?.system).toBe(true);
    expect(summaries.find((entry) => entry.name === "Finance")?.system).toBe(false);
  });

  // Renamed or archived away after filing: the name on the item no longer resolves. Saying so beats
  // showing a heading that means something different now.
  it("gathers items whose category is unknown into an unfiled bucket", () => {
    const summaries = summariseByCategory([filed("Retired"), item({ id: "b" })], known);
    const unfiled = summaries.find((entry) => entry.key === UNFILED_CATEGORY_KEY);
    expect(unfiled?.captures).toBe(2);
  });

  it("omits the unfiled bucket entirely when everything resolved", () => {
    const summaries = summariseByCategory([filed("Finance")], known);
    expect(summaries.some((entry) => entry.key === UNFILED_CATEGORY_KEY)).toBe(false);
  });

  it("puts what is waiting first, then volume, then name", () => {
    const summaries = summariseByCategory(
      [
        filed("Finance", { id: "a" }),
        filed("Finance", { id: "b" }),
        filed("Logistics", { group: "actionable", id: "c" }),
      ],
      known,
    );
    expect(summaries.map((entry) => entry.name)).toEqual(["Logistics", "Finance", "Empty"]);
  });
});

describe("filtering to one category", () => {
  it("returns only what is filed under that slug", () => {
    const items = [filed("Finance", { id: "a" }), filed("Logistics", { id: "b" })];
    expect(filterByCategory(items, "finance", known).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("returns the unresolved items for the unfiled bucket", () => {
    const items = [filed("Finance", { id: "a" }), filed("Retired", { id: "b" }), item({ id: "c" })];
    expect(
      filterByCategory(items, UNFILED_CATEGORY_KEY, known)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["b", "c"]);
  });

  // A slug this build cannot resolve returns nothing rather than everything: a screen that shows
  // the whole inbox under a category heading states something false.
  it("returns nothing for a slug that resolves to no category", () => {
    expect(filterByCategory([filed("Finance")], "gone", known)).toEqual([]);
  });
});
