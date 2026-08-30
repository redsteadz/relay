import { motion } from "./tokens";

export function resolveMotionDuration(reducedMotion: boolean, duration: number): number {
  return reducedMotion ? motion.duration.instant : duration;
}
