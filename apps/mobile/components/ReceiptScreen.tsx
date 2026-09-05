import type { PropsWithChildren, ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenTopBar } from "@/components/ui";
import { useRelayTheme } from "@/theme";

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
  const { colors, layout, spacing } = theme.relay;
  const contentStyle = [
    styles.content,
    {
      gap: spacing.md,
      paddingBottom: layout.screenBottom,
      paddingHorizontal: layout.compactGutter,
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
  content: { width: "100%" },
  keyboard: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { flex: 1 },
});
