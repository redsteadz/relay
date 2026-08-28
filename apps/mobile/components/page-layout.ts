import { spacing } from "../theme/tokens";

export const narrowViewportBreakpoint = 480;

export function getPageLayout(viewportWidth: number) {
  const isNarrow = viewportWidth < narrowViewportBreakpoint;
  return {
    headerDirection: isNarrow ? ("column" as const) : ("row" as const),
    pagePadding: isNarrow ? spacing.lg : spacing.xl,
  };
}
