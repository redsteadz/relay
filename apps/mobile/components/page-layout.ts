import { layout, sizes } from "../theme/tokens";

export const narrowViewportBreakpoint = layout.narrowBreakpoint;

export function getPageLayout(viewportWidth: number) {
  const isNarrow = viewportWidth < narrowViewportBreakpoint;
  return {
    headerDirection: isNarrow ? ("column" as const) : ("row" as const),
    pagePadding: isNarrow ? layout.compactGutter : layout.regularGutter,
  };
}

export function getContextualNoticeWidth(
  viewportWidth: number,
  anchorX: number = layout.compactGutter,
) {
  return Math.min(
    sizes.noticeMaxWidth,
    Math.max(0, viewportWidth - anchorX - layout.compactGutter),
  );
}
