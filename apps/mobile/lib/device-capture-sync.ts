import type { Session } from "@supabase/supabase-js";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { syncQueuedCaptures } from "./capture-sync";
import { deriveQueuedCaptures } from "./device-derivation";
import { registerInstallation } from "./device";

/** Reads enabled sources, derives what is queued, then uploads a single encrypted queue snapshot. */
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

  // Before registration and upload, both of which need the network. A capture's envelope leaves the
  // queue when it is acknowledged, so deriving after the upload would derive nothing, and deriving
  // only when the upload succeeds would leave an offline phone knowing nothing about its own captures.
  await deriveQueuedCaptures(session.user.id);

  const device = await registerInstallation(session.user.id, session.access_token);
  await syncQueuedCaptures(session.user.id, device.id, session.access_token);
}
