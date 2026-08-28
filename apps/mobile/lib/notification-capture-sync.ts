import type { Session } from "@supabase/supabase-js";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { syncQueuedCaptures } from "./capture-sync";
import { registerInstallation } from "./device";

/** Uploads a queue snapshot only while listener access and the user's capture control are active. */
export async function syncNotificationCaptures(session: Session): Promise<void> {
  const capabilities = await RelayDeviceIngress.getCapabilities();
  if (!capabilities.notificationListener || capabilities.notificationCapturePaused) return;

  const device = await registerInstallation(session.user.id, session.access_token);
  await syncQueuedCaptures(session.user.id, device.id, session.access_token);
}
