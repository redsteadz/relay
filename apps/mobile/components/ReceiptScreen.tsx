import type { PropsWithChildren, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
// Gesture-handler's ScrollView, not React Native's. On Android the platform ScrollView claims a
// touch natively before gesture-handler can arbitrate for it, so a row's swipe had to wait for the
// scroll view to decide it was not interested. This one is a native gesture handler itself and
// negotiates with the row directly, which is what makes a swipe start on the first frame.
import { ScrollView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenTopBar } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { getPageLayout } from "./page-layout";

type ReceiptScreenProps = PropsWithChildren<{
  /** A single control in the header's trailing slot. */
  action?: ReactNode;
  /** Shown when the screen was reached from another one. */
  onBack?: (() => void) | undefined;
  /**
   * Pinned above the content, outside the scroll flow.
   *
   * A transient bar placed among the children shifts everything below it each time it appears and
   * again when it leaves, which moves the very rows a person is reading.
   */
  overlay?: ReactNode;
  /**
   * False when the children manage their own scrolling, such as a long virtualized list.
   *
   * Nesting a FlatList inside this frame's ScrollView would defeat its windowing and warn at
   * runtime, so a screen that owns a list opts out and takes the padding on itself.
   */
  scroll?: boolean;
  /** Pinned below the header and above the scroll: outcome tabs, a filter row, a search field. */
  sticky?: ReactNode;
  title: string;
}>;

/**
 * The frame every screen in the receipt-first layout sits in.
 *
 * It replaces the eyebrow/title/detail header, which spent the top third of a phone restating the
 * tab a person had just tapped. Here the title is one line, anything that filters the screen is
 * pinned under it, and the content starts high enough that the first item is readable without
 * scrolling -- which is the whole argument for a receipt list.
 */
export function ReceiptScreen({
  action,
  children,
  onBack,
  overlay,
  scroll = true,
  sticky,
  title,
}: ReceiptScreenProps) {
  const theme = useRelayTheme();
  const { colors, layout, sizes, spacing } = theme.relay;
  // A phone gets the compact gutter; a tablet or a browser gets the wider one and stops the column
  // growing past a readable measure. A receipt list stretched edge to edge on a desktop viewport is
  // unreadable in exactly the way the old shell already knew how to avoid.
  const { pagePadding } = getPageLayout(useWindowDimensions().width);
  const contentStyle = [
    styles.content,
    {
      gap: spacing.md,
      maxWidth: sizes.contentMaxWidth,
      paddingBottom: layout.screenBottom,
      paddingHorizontal: pagePadding,
      paddingTop: spacing.md,
    },
  ];

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScreenTopBar action={action} onBack={onBack} title={title} />
        {sticky}
        {overlay}
        {scroll ? (
          <ScrollView
            contentContainerStyle={contentStyle}
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[contentStyle, styles.scroll]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { alignSelf: "center", width: "100%" },
  keyboard: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { flex: 1 },
});
