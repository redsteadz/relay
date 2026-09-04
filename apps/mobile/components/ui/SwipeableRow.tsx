import type { PropsWithChildren } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Icon } from "react-native-paper";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useAppMotion } from "@/hooks/useAppMotion";
import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

/**
 * How far the row must travel, as a share of screen width, before releasing dismisses it.
 *
 * Matched to the platform's own notification shade rather than chosen: a person arrives with that
 * gesture already in their hands, and a row that demands a longer drag than the shade does reads as
 * stiff even when nothing is technically wrong.
 */
const DISMISS_RATIO = 0.35;

/** A flick dismisses regardless of distance, which is what makes the shade feel effortless. */
const DISMISS_VELOCITY = 800;

type SwipeableRowProps = PropsWithChildren<{
  /** Spoken description of what the action does, used for the assistive-technology equivalent. */
  actionLabel: string;
  /** Icon shown behind the row as it travels. */
  icon: string;
  /** Runs once the row has left. */
  onAction: () => void;
}>;

/**
 * A row that is swiped away, the way a notification is.
 *
 * The row tracks the finger for the whole gesture and leaves the screen when released past the
 * threshold or flicked. It is deliberately not a reveal: an action drawn under a row that stops at
 * a fixed open position hits a wall mid-drag, and that wall is what makes a swipe feel rigid no
 * matter how the friction is tuned. Here there is nothing to stop against.
 *
 * What is drawn behind is a hint rather than a control -- it fades in with the drag to say what
 * releasing will do, and needs no press of its own.
 *
 * The gesture claims horizontal movement only, and yields outright once a drag turns vertical, so
 * the list underneath still scrolls. Movement is one-to-one; damping it makes the row lag the hand
 * and reads as the gesture failing rather than resisting.
 *
 * A swipe is invisible to a screen reader and impossible for some motor abilities, so the same
 * action is always published as an accessibility action. Nothing here is reachable only by dragging.
 */
export function SwipeableRow({ actionLabel, children, icon, onAction }: SwipeableRowProps) {
  const theme = useRelayTheme();
  const { duration, reducedMotion } = useAppMotion();
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(0);

  const threshold = width * DISMISS_RATIO;
  // Resolved here rather than inside the gesture: `duration` is an ordinary function on the React
  // side, and the gesture callbacks run as worklets on the UI runtime, which cannot call into it.
  const exitDuration = duration(200);

  const pan = Gesture.Pan()
    // Horizontal intent has to be established before the row moves, and a vertical drag fails the
    // gesture outright, so the scroll view keeps every gesture that was meant for it.
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      // Rows travel one way. Dragging back toward rest is allowed; dragging past it is not.
      translateX.value = Math.min(0, event.translationX);
    })
    .onEnd((event) => {
      const travelled = -translateX.value;
      const flicked = event.velocityX < -DISMISS_VELOCITY;
      if (travelled < threshold && !flicked) {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        return;
      }
      if (reducedMotion) {
        translateX.value = 0;
        runOnJS(onAction)();
        return;
      }
      translateX.value = withTiming(-width, { duration: exitDuration }, (finished) => {
        if (finished === true) runOnJS(onAction)();
      });
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-translateX.value, [0, threshold], [0, 1], "clamp"),
  }));

  return (
    <View
      accessibilityActions={[{ label: actionLabel, name: "hide" }]}
      onAccessibilityAction={(action) => {
        if (action.nativeEvent.actionName === "hide") onAction();
      }}
      style={styles.container}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.hint,
          hintStyle,
          { gap: theme.relay.spacing.xxs, paddingRight: theme.relay.spacing.lg },
        ]}
      >
        <Icon color={theme.relay.colors.danger} size={theme.relay.sizes.icon.md} source={icon} />
        <AppText style={{ color: theme.relay.colors.danger }} variant="caption">
          {actionLabel}
        </AppText>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: "center" },
  hint: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
