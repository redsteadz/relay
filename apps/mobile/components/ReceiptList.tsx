import { useMemo } from "react";
import { FlatList, StyleSheet, useWindowDimensions, type ListRenderItem } from "react-native";

import { useRelayTheme } from "@/theme";

import { getPageLayout } from "./page-layout";

/**
 * How much more than one screenful stays mounted.
 *
 * `windowSize` is measured in viewports, so 1.4 keeps what is visible plus twenty percent above and
 * below. The inbox rendered every row it had read -- up to a full page of receipt cards -- before it
 * could paint anything, which is the entire first-open delay.
 *
 * Raise this first if fast scrolling shows blank space: the cost of a smaller window is that
 * flinging can outrun the renderer, and the cost of a larger one is the delay this exists to remove.
 */
const WINDOW_SIZE = 1.4;

/**
 * Roughly a screenful, which is all that has to exist before the first paint.
 *
 * Deliberately not tied to a measured row height: receipt cards vary with their content, and a
 * number that tried to be exact would be wrong on every screen except the one it was measured on.
 */
const INITIAL_ROWS = 8;

type ReceiptListProps<T> = {
  data: readonly T[];
  footer?: React.ReactElement | undefined;
  header?: React.ReactElement | undefined;
  keyExtractor: (item: T) => string;
  /** Called as the end comes into view, for a screen that loads more than its first page. */
  onEndReached?: (() => void) | undefined;
  renderItem: ListRenderItem<T>;
};

/**
 * The windowed list a receipt screen owns instead of handing its rows to the frame's `ScrollView`.
 *
 * Pair it with `scroll={false}` on `ReceiptScreen`: nesting this inside that frame's scroll view
 * would defeat the windowing and warn at runtime. The padding the frame would have applied is taken
 * here instead, so the scroll bar runs the full height rather than inside a gutter.
 */
export function ReceiptList<T>({
  data,
  footer,
  header,
  keyExtractor,
  onEndReached,
  renderItem,
}: ReceiptListProps<T>) {
  const theme = useRelayTheme();
  const { layout, sizes, spacing } = theme.relay;
  const { pagePadding } = getPageLayout(useWindowDimensions().width);

  const contentStyle = useMemo(
    () => ({
      alignSelf: "center" as const,
      gap: spacing.md,
      maxWidth: sizes.contentMaxWidth,
      paddingBottom: layout.screenBottom,
      paddingHorizontal: pagePadding,
      paddingTop: spacing.md,
      width: "100%" as const,
    }),
    [layout.screenBottom, pagePadding, sizes.contentMaxWidth, spacing.md],
  );

  return (
    <FlatList
      ListFooterComponent={footer}
      ListHeaderComponent={header}
      contentContainerStyle={contentStyle}
      data={data}
      initialNumToRender={INITIAL_ROWS}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      maxToRenderPerBatch={INITIAL_ROWS}
      onEndReached={onEndReached}
      // Far enough ahead that a page lands before the reader reaches the end, close enough that an
      // idle screen does not ask for one it will never show.
      onEndReachedThreshold={0.6}
      // Android only, and the reason a long list stops holding every row's view alive.
      removeClippedSubviews
      renderItem={renderItem}
      style={styles.list}
      windowSize={WINDOW_SIZE}
    />
  );
}

const styles = StyleSheet.create({ list: { flex: 1 } });
