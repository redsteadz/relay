import { useCallback, useEffect, useState } from "react";

import { readOnboardingComplete, writeOnboardingComplete } from "@/lib/onboarding-storage";
import { logMobileError, runInBackground } from "@/lib/observability";

export type OnboardingState = {
  /** Marks the introduction seen. Resolves once it is persisted. */
  complete: () => void;
  /** Undefined until storage has answered, so the app never flashes the wrong screen. */
  seen: boolean | undefined;
};

/**
 * Whether to show the introduction.
 *
 * `seen` stays undefined until storage answers. Defaulting to false would show the introduction for
 * one frame to every returning user, and defaulting to true would skip it for a new one -- both are
 * worse than holding the splash for the length of one local read.
 *
 * A read failure resolves to "seen" rather than blocking. Being unable to record that someone read
 * the introduction is not a reason to trap them in it.
 */
export function useOnboardingState(): OnboardingState {
  const [seen, setSeen] = useState<boolean | undefined>();

  useEffect(() => {
    let active = true;
    void readOnboardingComplete()
      .then((value) => {
        if (active) setSeen(value);
      })
      .catch((error: unknown) => {
        logMobileError("storage.onboarding_read_failed", error, {
          code: "ONBOARDING_READ_FAILED",
          integration: "async-storage",
          operation: "readOnboardingComplete",
        });
        if (active) setSeen(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const complete = useCallback(() => {
    setSeen(true);
    runInBackground(writeOnboardingComplete(), "storage.onboarding_write_failed", {
      code: "ONBOARDING_WRITE_FAILED",
      integration: "async-storage",
      operation: "writeOnboardingComplete",
    });
  }, []);

  return { complete, seen };
}
