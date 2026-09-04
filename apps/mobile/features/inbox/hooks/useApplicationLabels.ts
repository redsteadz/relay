import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

/**
 * Human names for the applications that produced captures.
 *
 * `APP_LABEL` in the presentation model names four packages by hand, so everything else displayed a
 * raw `com.example.foo` as the visible name of a whole group. The device already knows the real
 * names, and asking it scales to whatever a person actually has installed.
 *
 * The result is narrowed to packages that produced a capture before it is returned, so nothing
 * about the rest of the installed list is retained. Resolution happens on device and the mapping is
 * never sent anywhere: it exists to draw a name on this screen and nowhere else.
 *
 * A device that cannot answer is not an error. The caller falls back to the exact package
 * identifier, which is honest if unlovely, rather than showing a guess.
 */
export function useApplicationLabels(
  applicationIds: readonly string[],
): ReadonlyMap<string, string> {
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
  // Sorted and joined so the effect re-runs when the set changes rather than on every render.
  const wanted = [...new Set(applicationIds)].sort().join("\u001f");

  useEffect(() => {
    if (Platform.OS !== "android" || wanted.length === 0) return;
    let active = true;

    void (async () => {
      try {
        const installed = await RelayDeviceIngress.getSelectableNotificationApps();
        if (!active) return;
        const requested = new Set(wanted.split("\u001f"));
        const resolved = new Map<string, string>();
        for (const app of installed) {
          if (requested.has(app.packageName)) resolved.set(app.packageName, app.label);
        }
        setLabels(resolved);
      } catch (error: unknown) {
        logMobileError("ui.application_labels_unavailable", error, {
          code: "APPLICATION_LABELS_UNAVAILABLE",
          integration: "relay-device-ingress",
          operation: "getSelectableNotificationApps",
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [wanted]);

  return labels;
}
