import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { readOnboardingComplete, writeOnboardingComplete } from "./onboarding-storage";
import { logMobileError, runInBackground } from "./observability";

type OnboardingContextValue = {
  /** Marks the introduction seen, for every reader at once. */
  complete: () => void;
  /** Undefined until storage has answered, so the app never flashes the wrong screen. */
  seen: boolean | undefined;
};

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

/**
 * Whether to show the introduction.
 *
 * This is a provider rather than a plain hook because two places need the same answer: the root
 * layout, whose route guard decides which screens exist, and the introduction itself, whose last
 * button ends it. Held as local state in each, completing the introduction updated only the screen's
 * own copy -- the guard kept its stale `false`, so the button appeared to do nothing until the app
 * was restarted and storage was read again.
 *
 * `seen` stays undefined until storage answers. Defaulting to false would show the introduction for
 * one frame to every returning user, and defaulting to true would skip it for a new one -- both are
 * worse than holding the splash for the length of one local read.
 *
 * A read failure resolves to "seen" rather than blocking. Being unable to record that someone read
 * the introduction is not a reason to trap them in it.
 */
export function OnboardingProvider({ children }: PropsWithChildren) {
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

  // The guard flips on this state, not on the write. Waiting for storage would leave the button
  // visibly dead for the length of a disk round trip, and a failed write is recoverable -- the
  // introduction simply appears once more next launch.
  const complete = useCallback(() => {
    setSeen(true);
    runInBackground(writeOnboardingComplete(), "storage.onboarding_write_failed", {
      code: "ONBOARDING_WRITE_FAILED",
      integration: "async-storage",
      operation: "writeOnboardingComplete",
    });
  }, []);

  return (
    <OnboardingContext.Provider value={{ complete, seen }}>{children}</OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (value === undefined) {
    throw new Error("useOnboarding requires an OnboardingProvider ancestor");
  }
  return value;
}
