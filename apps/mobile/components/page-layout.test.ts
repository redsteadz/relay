import { describe, expect, it } from "vitest";

import { interaction, spacing } from "../theme/tokens";

import { getPageLayout } from "./page-layout";

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
});
