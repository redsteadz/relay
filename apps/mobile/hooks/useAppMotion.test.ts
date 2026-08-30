import { describe, expect, it } from "vitest";

import { motion } from "@/theme/tokens";

import { resolveMotionDuration } from "@/theme/motion";

describe("reduced motion", () => {
  it("removes nonessential entrance duration when reduced motion is enabled", () => {
    expect(resolveMotionDuration(true, motion.duration.screen)).toBe(motion.duration.instant);
  });

  it("retains the semantic duration when motion is allowed", () => {
    expect(resolveMotionDuration(false, motion.duration.emphasis)).toBe(motion.duration.emphasis);
  });
});
