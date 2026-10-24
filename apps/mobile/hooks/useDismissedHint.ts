import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

import { logMobileError, runInBackground } from "@/lib/observability";

/** Hints a reader can put away for good. Fixed keys, so storage never holds anything derived. */
export type HintKey = "inbox-remove";

const storageKey = (hint: HintKey) => `relay.hint-dismissed.${hint}`;

/**
 * A one-time explanation, shown until the reader says they have it.
 *
 * Device-local for the same reason as the introduction: it records what a person has read on this
 * phone. Until the stored answer is known the hint stays hidden, so an experienced reader never sees
 * it flash in and out.
 */
export function useDismissedHint(hint: HintKey): { dismiss: () => void; visible: boolean } {
  const [dismissed, setDismissed] = useState<boolean | undefined>();

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey(hint))
      .then((value) => {
        if (active) setDismissed(value === "true");
      })
      .catch((error: unknown) => {
        logMobileError("ui.hint_read_failed", error, {
          code: "HINT_READ_FAILED",
          integration: "async-storage",
          operation: "readHintDismissed",
        });
        // Unreadable storage leaves the hint hidden: repeating it would be worse than missing it.
        if (active) setDismissed(true);
      });
    return () => {
      active = false;
    };
  }, [hint]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    runInBackground(AsyncStorage.setItem(storageKey(hint), "true"), "ui.hint_write_failed", {
      code: "HINT_WRITE_FAILED",
      integration: "async-storage",
      operation: "writeHintDismissed",
    });
  }, [hint]);

  return { dismiss, visible: dismissed === false };
}
