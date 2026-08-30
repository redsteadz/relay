import { describe, expect, it } from "vitest";

import { interaction, spacing } from "../theme/tokens";

import { getContextualNoticeWidth, getPageLayout } from "./page-layout";

describe("responsive page layout", () => {
  it("stacks the header and preserves content width on a narrow Android viewport", () => {
    expect(getPageLayout(360)).toEqual({
      headerDirection: "column",
      pagePadding: spacing.lg,
    });
  });

  it("uses a horizontal header when space is available on web", () => {
    expect(getPageLayout(1024)).toEqual({
      headerDirection: "row",
      pagePadding: spacing.xl,
    });
  });

  it("keeps interactive primitives at an accessible target size", () => {
    expect(interaction.minimumTarget).toBeGreaterThanOrEqual(48);
  });

  it("keeps contextual notice bubbles inside narrow viewport gutters", () => {
    expect(getContextualNoticeWidth(360)).toBe(296);
    expect(getContextualNoticeWidth(280)).toBe(248);
    expect(getContextualNoticeWidth(360, 120)).toBe(224);
  });
});
