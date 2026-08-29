import { describe, expect, it } from "vitest";

import { getButtonState, getMessageState } from "./component-state";

describe("AppButton states", () => {
  it("exposes disabled controls as inactive", () => {
    expect(getButtonState("primary", true, false)).toMatchObject({
      inactive: true,
      accessibilityState: { busy: false, disabled: true },
    });
  });

  it("announces loading and prevents a duplicate action", () => {
    expect(getButtonState("primary", false, true)).toMatchObject({
      inactive: true,
      accessibilityState: { busy: true, disabled: true },
    });
  });

  it("keeps destructive intent explicit", () => {
    expect(getButtonState("destructive", false, false)).toMatchObject({
      destructive: true,
      inactive: false,
    });
  });
});

describe("StatusMessage states", () => {
  it("announces errors assertively", () => {
    expect(getMessageState("error")).toEqual({
      accessibilityRole: "alert",
      liveRegion: "assertive",
    });
  });

  it("announces non-error feedback without interrupting", () => {
    expect(getMessageState("success")).toEqual({
      accessibilityRole: undefined,
      liveRegion: "polite",
    });
  });
});
