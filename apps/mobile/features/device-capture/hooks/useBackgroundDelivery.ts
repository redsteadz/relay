/**
 * The background delivery flag.
 *
 * Reading the stored choice and applying it are one operation here, because the preference and the
 * scheduled work are two things that can disagree and a control that reports a state it did not
 * arrange is worse than one that is absent. Every write goes through `setBackgroundSyncEnabled`,
 * which registers or unregisters before it records.
 */

import { useCallback, useEffect, useState } from "react";

import {
  backgroundSyncEnabled,
  backgroundSyncSupported,
  setBackgroundSyncEnabled,
  BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES,
} from "@/lib/background-capture-sync";
import { reportUnexpectedUiError } from "@/lib/observability";

type BackgroundDeliveryState = {
  busy: boolean;
  enabled: boolean;
  /** Set when the system refused the work, which is the person's own setting rather than a fault. */
  restricted: boolean;
  supported: boolean;
};

export function useBackgroundDelivery() {
  const supported = backgroundSyncSupported();
  const [state, setState] = useState<BackgroundDeliveryState>({
    busy: supported,
    enabled: false,
    restricted: false,
    supported,
  });

  useEffect(() => {
    if (!supported) return;
    let current = true;
    void (async () => {
      const enabled = await backgroundSyncEnabled();
      if (current) setState((previous) => ({ ...previous, busy: false, enabled }));
    })();
    return () => {
      current = false;
    };
  }, [supported]);

  const setEnabled = useCallback(async (next: boolean) => {
    setState((previous) => ({ ...previous, busy: true, restricted: false }));
    try {
      await setBackgroundSyncEnabled(next);
      setState((previous) => ({ ...previous, busy: false, enabled: next }));
    } catch (error: unknown) {
      // A restricted app is Android reporting the person's own choice back, so it is shown as a
      // state rather than logged as a failure. Anything else is unexpected and is reported.
      const restricted = error instanceof Error && error.message === "background_task_restricted";
      if (!restricted) {
        reportUnexpectedUiError(error, "ui.background_delivery_toggle_failed", {
          code: "BACKGROUND_DELIVERY_TOGGLE_FAILED",
          integration: "relay-device-ingress",
          operation: "setBackgroundSyncEnabled",
        });
      }
      setState((previous) => ({ ...previous, busy: false, restricted }));
    }
  }, []);

  return { ...state, intervalMinutes: BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES, setEnabled };
}
