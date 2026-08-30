import { layout } from "../theme/tokens";

export const narrowViewportBreakpoint = layout.narrowBreakpoint;

export function getPageLayout(viewportWidth: number) {
  const isNarrow = viewportWidth < narrowViewportBreakpoint;
  return {
    headerDirection: isNarrow ? ("column" as const) : ("row" as const),
    pagePadding: isNarrow ? layout.compactGutter : layout.regularGutter,
  };
}
