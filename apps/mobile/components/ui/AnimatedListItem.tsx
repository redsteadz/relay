import type { PropsWithChildren } from "react";
import Animated, { FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";

import { useRelayTheme } from "@/theme";

/**
 * A list row that leaves without the list snapping shut behind it.
 *
 * Removing an item used to be two uncoordinated motions: the row finished travelling off-screen,
 * and then every row below jumped up by its height in a single frame. The jump is what read as
 * broken -- the swipe itself was always smooth.
 *
 * `LinearTransition` animates the rows below into their new positions, and `FadeOut` gives the
 * departing row somewhere to go. Both run on the UI thread, so neither is affected by whatever the
 * React side is doing to settle the mutation that removed the item.
 *
 * Both honour the reader's system setting: with reduce-motion on, the row is removed and the list
 * closes immediately rather than sliding.
 */
export function AnimatedListItem({ children }: PropsWithChildren) {
  const theme = useRelayTheme();
  const { duration } = theme.relay.motion;

  return (
    <Animated.View
      exiting={FadeOut.duration(duration.fast).reduceMotion(ReduceMotion.System)}
      layout={LinearTransition.duration(duration.standard).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}
