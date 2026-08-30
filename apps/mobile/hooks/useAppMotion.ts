import { useReducedMotion } from "react-native-reanimated";

import { resolveMotionDuration } from "@/theme/motion";

export function useAppMotion() {
  const reducedMotion = useReducedMotion();
  return {
    reducedMotion,
    duration: (duration: number) => resolveMotionDuration(reducedMotion, duration),
  };
}
