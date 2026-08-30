import { describe, expect, it } from "vitest";

import { createSelectionDraft, selectionChanged, selectionDraftReducer } from "./selectionDraft";

describe("transactional source selection", () => {
  it("keeps edits local and restores the saved selection on cancel", () => {
    const saved = createSelectionDraft(["one"]);
    const edited = selectionDraftReducer(saved, { type: "add", value: "two" });

    expect(selectionChanged(edited)).toBe(true);
    expect(edited.saved).toEqual(["one"]);
    expect(selectionDraftReducer(edited, { type: "cancel" }).draft).toEqual(["one"]);
  });

  it("applies the current draft only after confirmation", () => {
    const edited = selectionDraftReducer(createSelectionDraft(["one"]), {
      type: "toggle",
      value: "two",
    });
    const confirmed = selectionDraftReducer(edited, { type: "confirm" });

    expect(confirmed.saved).toEqual(["one", "two"]);
    expect(selectionChanged(confirmed)).toBe(false);
  });
});
