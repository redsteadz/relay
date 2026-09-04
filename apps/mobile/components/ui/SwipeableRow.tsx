import type { PropsWithChildren } from "react";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { Icon } from "react-native-paper";

import { useAppMotion } from "@/hooks/useAppMotion";
import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

type SwipeableRowProps = PropsWithChildren<{
  /** Spoken description of what the action does, used for the assistive-technology equivalent. */
  actionLabel: string;
  /** Icon shown in the revealed action. */
  icon: string;
  /** Runs when the swipe completes or the accessibility action is invoked. */
  onAction: () => void;
}>;

/**
 * A row that reveals one action as it is dragged.
 *
 * The action is drawn underneath rather than triggered by an invisible hit region, so a person can
 * see what a swipe will do before committing to it, and can abandon the gesture after seeing it.
 *
 * A swipe is invisible to a screen reader and impossible for some motor abilities, so the same
 * action is always published as an accessibility action on the row. Assistive technology invokes it
 * directly; nothing here is reachable only by dragging.
 *
 * Only horizontal movement is claimed, so a vertical drag still scrolls the list it sits in.
 */
export function SwipeableRow({ actionLabel, children, icon, onAction }: SwipeableRowProps) {
  const theme = useRelayTheme();
  const { reducedMotion } = useAppMotion();
  const row = useRef<SwipeableMethods>(null);

  return (
    <ReanimatedSwipeable
      // Closing without animation under reduced motion still returns the row to rest; it simply
      // arrives there immediately rather than travelling.
      childrenContainerStyle={styles.child}
      friction={reducedMotion ? 1 : 2}
      onSwipeableOpen={() => {
        row.current?.close();
        onAction();
      }}
      overshootRight={!reducedMotion}
      ref={row}
      renderRightActions={() => (
        <View
          style={[
            styles.action,
            {
              backgroundColor: theme.relay.colors.surfaceRaised,
              gap: theme.relay.spacing.xxs,
              // The revealed action is a control in its own right, so it clears the shared touch
              // target rather than inheriting whatever height the row happens to have.
              minHeight: theme.relay.sizes.touchTarget,
              minWidth: theme.relay.sizes.touchTarget * 2,
              paddingHorizontal: theme.relay.spacing.lg,
            },
          ]}
        >
          <Icon color={theme.relay.colors.danger} size={theme.relay.sizes.icon.md} source={icon} />
          <AppText style={{ color: theme.relay.colors.danger }} variant="caption">
            {actionLabel}
          </AppText>
        </View>
      )}
      rightThreshold={theme.relay.sizes.touchTarget}
    >
      <View
        accessibilityActions={[{ label: actionLabel, name: "hide" }]}
        onAccessibilityAction={(action) => {
          if (action.nativeEvent.actionName === "hide") onAction();
        }}
      >
        {children}
      </View>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: "center", justifyContent: "center" },
  child: { backgroundColor: "transparent" },
});
