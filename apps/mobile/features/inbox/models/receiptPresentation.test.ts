import { describe, expect, it } from "vitest";

import type { InboxCategory, InboxItem } from "./inboxPresentation";
import {
  eventKindLabel,
  receiptDecision,
  receiptFactValue,
  receiptGlyph,
  receiptKindLine,
  receiptSourceLine,
} from "./receiptPresentation";

const now = new Date("2026-09-04T13:00:00.000Z");
/** Times render in the reader's own zone, so the expectation is derived rather than written out. */
const arrivedClock = new Date("2026-09-04T12:41:00.000Z").toTimeString().slice(0, 5);

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    appLabel: "Messages",
    category: undefined,
    confidence: undefined,
    content: undefined,
    evidence: [],
    group: "actionable",
    id: "event-1",
    kind: "fact",
    occurredAt: "2026-09-04T12:41:00.000Z",
    processing: "processed",
    retention: { rawExpired: false, rawExpiresAt: undefined },
    reviewReasons: [],
    scheduledAt: undefined,
    searchText: "",
    source: {
      applicationId: "com.google.android.apps.messaging",
      kind: "notification",
      occurredAt: "2026-09-04T12:41:00.000Z",
      sender: "Example Bank",
      subject: undefined,
      threadId: undefined,
    },
    sourceItemId: "source-1",
    summary: undefined,
    threadKey: undefined,
    title: "$14.20 at North Station",
    ...overrides,
  };
}

function category(overrides: Partial<InboxCategory> = {}): InboxCategory {
  return {
    confidence: 0.92,
    method: "deterministic",
    name: "Finance",
    rationale: undefined,
    ...overrides,
  };
}

describe("receipt glyph", () => {
  it("takes the first letter of the application", () => {
    expect(receiptGlyph("Messages")).toBe("M");
    expect(receiptGlyph("gmail")).toBe("G");
  });

  // A package identifier is what an unnamed application falls back to, and it starts with a letter
  // only after its scheme, so the first letter is found rather than the first character.
  it("skips leading punctuation and digits are kept", () => {
    expect(receiptGlyph("·com.example.bank")).toBe("C");
    expect(receiptGlyph("1Password")).toBe("1");
  });

  it("marks a nameless source rather than rendering an empty box", () => {
    expect(receiptGlyph("")).toBe("?");
    expect(receiptGlyph("···")).toBe("?");
  });
});

describe("receipt source line", () => {
  it("names the application and the party it came from", () => {
    expect(receiptSourceLine(item())).toBe("Messages · Example Bank");
  });

  it("omits an absent sender rather than trailing a separator", () => {
    const source = { ...item().source, sender: undefined };
    expect(receiptSourceLine(item({ source }))).toBe("Messages");
    expect(receiptSourceLine(item({ source: { ...source, sender: "" } }))).toBe("Messages");
  });
});

describe("receipt kind line", () => {
  it("names the event kind and when it arrived", () => {
    expect(receiptKindLine(item(), now)).toBe(`Record · ${arrivedClock}`);
    expect(receiptKindLine(item({ kind: "calendar-event" }), now)).toBe(
      `Appointment · ${arrivedClock}`,
    );
  });

  it("names the kind alone when the timestamp cannot be read", () => {
    const source = { ...item().source, occurredAt: "not-a-date" };
    expect(receiptKindLine(item({ source }), now)).toBe("Record");
  });

  it("names an unknown kind as a record rather than showing a slug", () => {
    expect(eventKindLabel("teleportation")).toBe("Record");
  });
});

describe("receipt decision", () => {
  it("names the category, the method, and the confidence", () => {
    expect(receiptDecision(category(), false)).toEqual({
      certain: true,
      text: "Finance · Deterministic · 92%",
    });
  });

  // The check mark is a claim that nothing left the account, so only a deterministic match earns it.
  it("marks anything that reached a model as uncertain", () => {
    const semantic = receiptDecision(category({ confidence: 0.74, method: "semantic" }), false);
    expect(semantic).toEqual({ certain: false, text: "Finance · Semantic fallback · 74%" });
  });

  it("marks a filing the user made as certain about its category but not deterministic", () => {
    expect(receiptDecision(category({ method: "manual" }), false)?.certain).toBe(false);
    expect(receiptDecision(category({ method: "manual" }), false)?.text).toContain("Set by you");
  });

  it("replaces confidence with unresolved when the item needs review", () => {
    expect(receiptDecision(category(), true)).toEqual({
      certain: false,
      text: "Finance · Deterministic · unresolved",
    });
  });

  it("says nothing at all when an item was never filed and is not in question", () => {
    expect(receiptDecision(undefined, false)).toBeUndefined();
  });

  it("still explains an unfiled item that needs review", () => {
    expect(receiptDecision(undefined, true)).toEqual({
      certain: false,
      text: "Unfiled · needs your review",
    });
  });

  it("names an unfiled category rather than leaving the line half-built", () => {
    expect(receiptDecision(category({ name: undefined }), false)?.text).toBe(
      "Unfiled · Deterministic · 92%",
    );
  });

  it("passes an unrecognized method through rather than dropping the line", () => {
    expect(receiptDecision(category({ method: "oracle" }), false)?.text).toContain("oracle");
  });

  it("omits confidence the classifier did not record", () => {
    expect(receiptDecision(category({ confidence: undefined }), false)?.text).toBe(
      "Finance · Deterministic",
    );
  });
});

describe("fact values", () => {
  it("shows an instant in the reader's own clock", () => {
    expect(receiptFactValue({ isInstant: true, value: "2026-09-04T12:40:00.000Z" }, now)).toBe(
      new Date("2026-09-04T12:40:00.000Z").toTimeString().slice(0, 5),
    );
  });

  it("leaves a non-instant value exactly as it was read", () => {
    expect(receiptFactValue({ isInstant: false, value: "14.20 USD" }, now)).toBe("14.20 USD");
  });

  // A value Relay cannot format is still a value it holds, so it is shown rather than blanked.
  it("falls back to the raw value when an instant cannot be parsed", () => {
    expect(receiptFactValue({ isInstant: true, value: "sometime" }, now)).toBe("sometime");
  });
});
