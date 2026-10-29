import type { Session } from "@supabase/supabase-js";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { syncQueuedCaptures } from "./capture-sync";
import { demoModeEnabled } from "./demo/mode";
import { deriveQueuedCaptures } from "./device-derivation";
import { registerInstallation } from "./device";
import { captureWorkAllowed, serializeCaptureWork } from "./capture-work";
import { prepareCaptureTenant } from "./capture-preparation";

/** Reads enabled sources, derives what is queued, then uploads a single encrypted queue snapshot. */
export async function syncDeviceCaptures(
  session: Session,
  onDerived?: () => Promise<void>,
  retryFailed = false,
): Promise<void> {
  return serializeCaptureWork(async () => {
    if (!captureWorkAllowed(session.user.id)) return;
    await prepareCaptureTenant(session.user.id, undefined, false);
    if (retryFailed) await RelayDeviceIngress.retryFailedCaptures(session.user.id);
    await deliverDeviceCaptures(session, onDerived);
  });
}

async function deliverDeviceCaptures(
  session: Session,
  onDerived?: () => Promise<void>,
): Promise<void> {
  // Nothing is queued in demo mode: a generated capture is derived on the device and lands in the
  // local store directly, so there is no envelope to register a device for or upload.
  if (demoModeEnabled()) return;
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
  await onDerived?.();

  const device = await registerInstallation(session.user.id, session.access_token);
  // Native reads are capped at fifty envelopes; drain up to the bounded 500-row device queue.
  for (let batch = 0; batch < 10; batch += 1) {
    if (batch > 0) await deriveQueuedCaptures(session.user.id);
    const result = await syncQueuedCaptures(session.user.id, device.id, session.access_token);
    if (result === undefined) return;
    if (result.pending > 0) throw new Error("Capture delivery remains pending");
    if (result.failed > 0) throw new Error("Capture delivery contains failed records");
    if (result.acknowledged < 50) return;
  }
}
