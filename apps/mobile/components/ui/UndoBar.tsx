import { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

type UndoBarProps = {
  /** Runs when the window closes without the reader acting. */
  onExpire: () => void;
  onUndo: () => void;
  /**
   * How long the offer stands. Long enough to notice a mistake, read the message, and reach the
   * control, which is why this is not the two seconds a transient toast usually gets.
   */
  timeoutMs?: number;
  message: string;
};

/**
 * A reversible action and the offer to reverse it.
 *
 * Shown after something is taken away, so the reader can put it back without hunting for where it
 * went. The message is announced rather than only drawn, because an element that appears silently
 * is invisible to a screen reader and the offer expires.
 *
 * Expiry is not a confirmation. Nothing is committed when this disappears -- the action already
 * happened -- so the only thing lost is the shortcut to undo it.
 */
export function UndoBar({ message, onExpire, onUndo, timeoutMs = 8000 }: UndoBarProps) {
  const theme = useRelayTheme();

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  useEffect(() => {
    const timer = setTimeout(onExpire, timeoutMs);
    return () => {
      clearTimeout(timer);
    };
  }, [onExpire, timeoutMs]);

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.bar,
        {
          backgroundColor: theme.relay.colors.surfaceRaised,
          borderColor: theme.relay.colors.borderSubtle,
          borderRadius: theme.relay.radii.md,
          borderWidth: theme.relay.borders.hairline,
          gap: theme.relay.spacing.md,
          padding: theme.relay.spacing.md,
        },
      ]}
    >
      <AppText style={styles.message}>{message}</AppText>
      <AppButton
        accessibilityHint="Puts the removed capture back in your inbox"
        label="Undo"
        onPress={onUndo}
        tone="secondary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: "center", flexDirection: "row", flexWrap: "wrap" },
  message: { flexShrink: 1, flexGrow: 1 },
});
