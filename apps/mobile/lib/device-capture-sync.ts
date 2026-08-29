import type { Session } from "@supabase/supabase-js";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { syncQueuedCaptures } from "./capture-sync";
import { registerInstallation } from "./device";

/** Reads enabled sources, then uploads a single encrypted queue snapshot. */
export async function syncDeviceCaptures(session: Session): Promise<void> {
  const capabilities = await RelayDeviceIngress.getCapabilities();
  const notificationActive =
    capabilities.notificationListener && !capabilities.notificationCapturePaused;
  const smsActive =
    capabilities.smsAvailable &&
    capabilities.smsPermissionGranted &&
    !capabilities.smsCapturePaused;
  if (!notificationActive && !smsActive) return;

  if (smsActive) await RelayDeviceIngress.syncSmsInbox(session.user.id);
  const device = await registerInstallation(session.user.id, session.access_token);
  await syncQueuedCaptures(session.user.id, device.id, session.access_token);
}
