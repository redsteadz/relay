import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import ReanimatedSwipeable, {
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { Icon } from "react-native-paper";
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

/**
 * How far the row must travel before releasing commits the action.
 *
 * Expressed in points rather than a share of the screen because `ReanimatedSwipeable` measures the
 * action panel itself; the threshold only has to be shorter than the panel is wide.
 */
const COMMIT_THRESHOLD = 96;

/**
 * Resistance applied to the drag.
 *
 * 1 is one-to-one with the finger. Anything higher makes the row lag the hand, which reads as the
 * gesture failing rather than resisting.
 */
const DRAG_FRICTION = 1;

type SwipeableRowProps = PropsWithChildren<{
  /** Spoken description of what the action does, used for the assistive-technology equivalent. */
  actionLabel: string;
  /** Icon shown behind the row as it travels. */
  icon: string;
  /** Runs as the row commits, before it has finished leaving. */
  onAction: () => void;
}>;

/**
 * A row that is swiped away.
 *
 * Built on `ReanimatedSwipeable` from gesture-handler rather than on a hand-rolled pan. The
 * hand-rolled version tracked the finger correctly but owned its own exit animation, so the row
 * finished travelling, *then* the item was removed, and the list closed the gap in a separate
 * uncoordinated frame. Every part of the gesture now runs on the UI thread inside one maintained
 * component, and the closing of the gap is a layout animation on the list rather than this row's
 * business.
 *
 * The action commits on `onSwipeableWillOpen` -- as the release animation begins, not after it
 * lands. The caller removes the item at that moment and its exit animation and the row's own
 * travel become the same motion instead of two consecutive ones.
 *
 * A swipe is invisible to a screen reader and impossible for some motor abilities, so the same
 * action is always published as an accessibility action. Nothing here is reachable only by dragging.
 */
export function SwipeableRow({ actionLabel, children, icon, onAction }: SwipeableRowProps) {
  const theme = useRelayTheme();

  return (
    <View
      accessibilityActions={[{ label: actionLabel, name: "hide" }]}
      onAccessibilityAction={(action) => {
        if (action.nativeEvent.actionName === "hide") onAction();
      }}
    >
      <ReanimatedSwipeable
        // Horizontal intent has to be established before the row moves, so a drag meant for the
        // scroll view stays with it.
        dragOffsetFromRightEdge={theme.relay.spacing.md}
        friction={DRAG_FRICTION}
        onSwipeableWillOpen={(direction) => {
          // Right-side actions open on a negative translation, which the component reports as
          // LEFT: the direction names the way the row travelled, not the side that was revealed.
          if (direction === SwipeDirection.LEFT) onAction();
        }}
        // The row travels one way and does not rebound past rest: it is leaving, not opening a
        // drawer to be read.
        overshootRight={false}
        renderRightActions={(progress) => (
          <SwipeHint actionLabel={actionLabel} icon={icon} progress={progress} />
        )}
        rightThreshold={COMMIT_THRESHOLD}
      >
        {children}
      </ReanimatedSwipeable>
    </View>
  );
}

/**
 * What is drawn behind the row as it travels.
 *
 * A hint rather than a control: it says what releasing will do and needs no press of its own. It
 * fades and settles into place with the drag, so the row never hits a wall at a fixed open
 * position -- the thing that makes a reveal-style swipe feel rigid however the friction is tuned.
 */
function SwipeHint({
  actionLabel,
  icon,
  progress,
}: {
  actionLabel: string;
  icon: string;
  progress: SharedValue<number>;
}) {
  const theme = useRelayTheme();
  const { colors, radii, sizes, spacing } = theme.relay;

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], "clamp"),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.85, 1], "clamp") }],
  }));

  return (
    <View
      style={[
        styles.hint,
        {
          backgroundColor: colors.dangerSurface,
          borderRadius: radii.md,
          paddingHorizontal: spacing.lg,
        },
      ]}
    >
      <Animated.View style={[styles.hintContent, style, { gap: spacing.xs }]}>
        <Icon color={colors.onDangerSurface} size={sizes.icon.md} source={icon} />
        <AppText style={{ color: colors.onDangerSurface }} variant="label">
          {actionLabel}
        </AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { alignItems: "flex-end", justifyContent: "center" },
  hintContent: { alignItems: "center", flexDirection: "row" },
});
