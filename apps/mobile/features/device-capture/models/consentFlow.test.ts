import { describe, expect, it } from "vitest";

import { consentReducer, consentSubmitEnabled, initialConsentState } from "./consentFlow";

describe("source consent checkbox", () => {
  it("stays controlled and enables submit only after consent is checked", () => {
    expect(initialConsentState.checked).toBe(false);
    expect(consentSubmitEnabled(initialConsentState, false)).toBe(false);

    const checked = consentReducer(initialConsentState, { checked: true, type: "set" });
    expect(checked.checked).toBe(true);
    expect(consentSubmitEnabled(checked, false)).toBe(true);
    expect(consentSubmitEnabled(checked, true)).toBe(false);
  });

  it("resets only when the flow explicitly dispatches reset", () => {
    const checked = consentReducer(initialConsentState, { checked: true, type: "set" });
    expect(consentReducer(checked, { type: "reset" })).toEqual(initialConsentState);
  });
});
