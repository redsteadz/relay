import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress, { type SelectableNotificationApp } from "@/modules/relay-device-ingress";

export function useSelectableNotificationApps(enabled: boolean) {
  const [apps, setApps] = useState<SelectableNotificationApp[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(undefined);
    try {
      setApps(await RelayDeviceIngress.getSelectableNotificationApps());
    } catch (error: unknown) {
      logMobileError("capture.notification_apps_load_failed", error, {
        code: "NOTIFICATION_APPS_LOAD_FAILED",
        integration: "relay-device-ingress",
        operation: "getSelectableNotificationApps",
      });
      setApps([]);
      setError("Could not load launchable apps.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh]),
  );

  return { apps, error, loading, refresh };
}
