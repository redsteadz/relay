import type { PropsWithChildren, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Dialog, Portal } from "react-native-paper";

import { ActionRow } from "./ActionRow";

import { useRelayTheme } from "@/theme";

/**
 * Share of the screen a dialog may occupy.
 *
 * Leaves the surrounding screen visible so a dialog reads as something on top of the app rather
 * than a new one, and guarantees room for the actions no matter how long the body grows.
 */
const MAX_HEIGHT_RATIO = 0.85;

type AppDialogProps = PropsWithChildren<{
  /** Confirm and cancel controls. Always visible; never scrolls away with the body. */
  actions: ReactNode;
  dismissable?: boolean;
  icon?: string | undefined;
  onDismiss: () => void;
  title: string;
  visible: boolean;
}>;

/**
 * A dialog whose body scrolls and whose actions stay reachable.
 *
 * Paper's `Dialog` sets no maximum height and its `ScrollArea` only scrolls when it has a bounded
 * parent to shrink against. A dialog that simply wrapped its contents therefore grew with them,
 * pushed its own confirm button past the bottom of the screen, and left a form that could be filled
 * in but never submitted.
 *
 * The height is bounded here, the body is the only part allowed to shrink, and the actions sit
 * outside the scrolling region. A dialog cannot be built through this component that a person can
 * fill in but not complete.
 */
export function AppDialog({
  actions,
  children,
  dismissable = true,
  icon,
  onDismiss,
  title,
  visible,
}: AppDialogProps) {
  const theme = useRelayTheme();
  const { height } = useWindowDimensions();

  return (
    <Portal>
      <Dialog
        dismissable={dismissable}
        onDismiss={onDismiss}
        style={{ borderRadius: theme.relay.radii.lg, maxHeight: height * MAX_HEIGHT_RATIO }}
        visible={visible}
      >
        {/* Shrinkable, so the scroll area inside it has something to shrink against. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.body}
        >
          {icon === undefined ? null : <Dialog.Icon icon={icon} />}
          <Dialog.Title style={[theme.relay.typography.heading, styles.title]}>
            {title}
          </Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView
              contentContainerStyle={{ paddingVertical: theme.relay.spacing.md }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </Dialog.ScrollArea>
          {/*
            Paper's `Dialog.Actions` clones each child to force `compact`, `uppercase`, and a
            margin onto it, which a fragment or any non-Paper element cannot accept. The actions
            are laid out here instead, so a caller may pass whatever shape reads best.
          */}
          <View
            style={[
              styles.actions,
              {
                paddingBottom: theme.relay.spacing.lg,
                paddingHorizontal: theme.relay.spacing.lg,
                paddingTop: theme.relay.spacing.md,
              },
            ]}
          >
            <ActionRow>{actions}</ActionRow>
          </View>
        </KeyboardAvoidingView>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  // Actions sit at the trailing edge and never shrink, so they stay reachable whatever the body does.
  actions: { alignItems: "flex-end", flexShrink: 0 },
  body: { flexShrink: 1 },
  scrollArea: { flexShrink: 1 },
  title: { textAlign: "center" },
});
