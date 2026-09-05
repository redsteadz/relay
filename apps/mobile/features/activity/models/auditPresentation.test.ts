import { describe, expect, it } from "vitest";

import {
  auditEntry,
  filterActivity,
  groupActivityByDay,
  type ActivityEntry,
  type AuditEntryInput,
} from "./activityPresentation";

function row(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    action: "filter.revision_compiled",
    createdAt: "2026-09-04T09:00:00.000Z",
    id: "1",
    provider: null,
    purgedCount: null,
    version: "3",
    ...overrides,
  };
}

describe("audit entries", () => {
  it("names a saved rule and the version it produced", () => {
    expect(auditEntry(row())).toMatchObject({
      detail: "v3",
      kind: "rule",
      title: "Rule saved",
    });
  });

  it("counts purged payloads in the reader's own words", () => {
    expect(
      auditEntry(row({ action: "privacy.raw_payloads_purged", purgedCount: "41", version: null }))
        ?.detail,
    ).toBe("41 payloads deleted");
    expect(
      auditEntry(row({ action: "privacy.raw_payloads_purged", purgedCount: "1", version: null }))
        ?.detail,
    ).toBe("1 payload deleted");
  });

  it("names the provider a connection belonged to", () => {
    const entry = auditEntry(
      row({ action: "connector.disconnected", provider: "google-tasks", version: null }),
    );
    expect(entry).toMatchObject({ detail: "Google Tasks", kind: "source" });
  });

  // A row whose metadata this build cannot read still happened, so it keeps its title.
  it("still describes a row carrying no readable metadata", () => {
    expect(auditEntry(row({ purgedCount: null, version: null }))?.detail).toBe("Recorded by Relay");
    expect(auditEntry(row({ version: "" }))?.detail).toBe("Recorded by Relay");
  });

  // Actions and disclosures have their own richer read paths; showing them from here as well would
  // put the same event on the timeline twice.
  it("drops an action this build has no name for rather than guessing", () => {
    expect(auditEntry(row({ action: "action.approved" }))).toBeUndefined();
    expect(auditEntry(row({ action: "filter.semantic_evaluated" }))).toBeUndefined();
    expect(auditEntry(row({ action: "something.new" }))).toBeUndefined();
  });

  it("prefixes its id so an audit row cannot collide with a ledger run", () => {
    expect(auditEntry(row({ id: "7" }))?.id).toBe("audit-7");
  });
});

/**
 * Days are named against the reader's own calendar, so the fixtures are built from a local noon
 * rather than from UTC instants. A UTC literal lands on a different calendar day depending on where
 * the test runs, which would make "Today" pass or fail by timezone.
 */
const now = new Date(2026, 8, 4, 20, 0, 0);
function daysBefore(offset: number): string {
  return new Date(2026, 8, 4 - offset, 12, 0, 0).toISOString();
}

const entries: readonly ActivityEntry[] = [
  { detail: "", icon: "", id: "a", kind: "rule", occurredAt: daysBefore(0), title: "" },
  { detail: "", icon: "", id: "b", kind: "retention", occurredAt: daysBefore(1), title: "" },
  { detail: "", icon: "", id: "c", kind: "source", occurredAt: daysBefore(5), title: "" },
];

describe("narrowing the timeline", () => {
  it("returns everything for the absence of a filter", () => {
    expect(filterActivity(entries, "all")).toHaveLength(3);
  });

  it("keeps only the chosen kind", () => {
    expect(filterActivity(entries, "rule").map((entry) => entry.id)).toEqual(["a"]);
    expect(filterActivity(entries, "action")).toHaveLength(0);
  });
});

describe("grouping by day", () => {
  it("names today and yesterday and dates anything older", () => {
    const days = groupActivityByDay(entries, now);
    expect(days.map((day) => day.day).slice(0, 2)).toEqual(["Today", "Yesterday"]);
    expect(days[2]?.day).not.toBe("Yesterday");
  });

  it("keeps the order it was given rather than re-sorting", () => {
    const days = groupActivityByDay(entries, now);
    expect(days.flatMap((day) => day.entries.map((entry) => entry.id))).toEqual(["a", "b", "c"]);
  });

  it("collects consecutive entries from one day into a single group", () => {
    const sameDay = [entries[0], { ...entries[0], id: "a2" }] as readonly ActivityEntry[];
    const days = groupActivityByDay(sameDay, now);
    expect(days).toHaveLength(1);
    expect(days[0]?.entries).toHaveLength(2);
  });

  // One unparseable timestamp must not take the screen down or claim a day it does not have.
  it("gathers undated entries rather than dropping them", () => {
    const days = groupActivityByDay([{ ...entries[0], id: "bad", occurredAt: "not-a-date" }], now);
    expect(days[0]?.day).toBe("Undated");
  });

  it("returns nothing for an empty timeline", () => {
    expect(groupActivityByDay([], now)).toEqual([]);
  });
});
