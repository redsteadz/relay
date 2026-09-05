import { describe, expect, it } from "vitest";

import {
  dataHoldings,
  holdingAccessibilityLabel,
  holdingMarks,
  holdingPlaces,
} from "./dataHoldings";

describe("data holdings", () => {
  it("gives every row one mark per boundary", () => {
    for (const holding of dataHoldings) {
      expect(holding.levels).toHaveLength(holdingPlaces.length);
    }
  });

  it("has a distinct mark for every level so the table is readable without colour", () => {
    expect(new Set(Object.values(holdingMarks)).size).toBe(Object.keys(holdingMarks).length);
  });

  // The claim the whole screen rests on: a raw capture is never held by a model or a provider.
  it("states that raw captures never leave for a model or a provider", () => {
    const raw = dataHoldings.find((holding) => holding.label === "Raw capture");
    expect(raw?.levels).toEqual(["partial", "partial", "none", "none"]);
    expect(raw?.note).toContain("seven days");
  });

  it("states that the key is held only by the backend", () => {
    const key = dataHoldings.find((holding) => holding.label === "OpenAI key");
    expect(key?.levels).toEqual(["none", "full", "n/a", "none"]);
  });

  it("reads a row aloud as a sentence rather than as a row of symbols", () => {
    const label = holdingAccessibilityLabel(dataHoldings[0]);
    for (const place of holdingPlaces) expect(label).toContain(place);
    expect(label).not.toContain(holdingMarks.partial);
  });

  it("gives every row a note, because four marks cannot qualify themselves", () => {
    for (const holding of dataHoldings) {
      expect(holding.note.length).toBeGreaterThan(0);
    }
  });
});
