/**
 * Granting capture to an application because a rule named it, not because someone ticked it in a
 * list (ADR-0023).
 *
 * `configureNotificationCapture` replaces the whole allowlist rather than appending to it, so this
 * reads the device's current one first and only writes back when a named application is not
 * already in it -- an edit that renames nothing should not re-issue an identical native call.
 *
 * It also starts capture when this is the first application ever granted on this device, since
 * onboarding no longer has a separate app-selection step to do that (ADR-0023) -- without this, a
 * fresh install's first rule would add its app to the allowlist and still never see a notification,
 * because the native default leaves capture paused until something configures it otherwise.
 */

import {
  nextNotificationAllowlist,
  nextNotificationCapturePaused,
} from "@/lib/notification-capture";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

export async function authorizeNamedApplications(
  tenantId: string | undefined,
  applicationIds: readonly string[],
): Promise<void> {
  if (tenantId === undefined || applicationIds.length === 0) return;
  const capabilities = await RelayDeviceIngress.getCapabilities();
  const next = nextNotificationAllowlist(capabilities.notificationAllowedPackages, applicationIds);
  if (next === undefined) return;
  await RelayDeviceIngress.configureNotificationCapture(
    tenantId,
    next,
    nextNotificationCapturePaused(
      capabilities.notificationAllowedPackages,
      capabilities.notificationCapturePaused,
    ),
  );
}
