import type { Session } from "@supabase/supabase-js";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { syncQueuedCaptures } from "./capture-sync";
import { registerInstallation } from "./device";
import { logMobileError } from "./observability";

/**
 * Reads whatever consent currently allows, then uploads everything already held.
 *
 * Reading and uploading are gated differently on purpose. Reading the SMS inbox is a capture, so it
 * happens only while that source is granted, unpaused, and available. Uploading is not a capture:
 * those envelopes were taken under consent that applied when they were taken, and they are already
 * encrypted on this device.
 *
 * Gating the upload on a live source as well is what stranded the queue. Pausing a source, losing
 * the listener grant, or running a build where SMS is not available left captures that had already
 * been taken with no way out -- unsent until they expired, while the queue read as untouched because
 * nothing had reached it. `docs/integrations/android.md` describes the intended split: a pause stops
 * new reads, queued rows remain intact, and deleting queued captures is its own explicit action.
 */
export async function syncDeviceCaptures(session: Session): Promise<void> {
  await readNewSms(session);

  await syncQueuedCaptures(
    session.user.id,
    async () => (await registerInstallation(session.user.id, session.access_token)).id,
    session.access_token,
  );
}

/**
 * Reads the SMS inbox when that source is live.
 *
 * Failing to read is reported and then left behind rather than propagated, because the upload that
 * follows is about captures already taken and does not depend on this having succeeded. Letting a
 * failure here escape would have meant an unreadable inbox -- or a capabilities call that could not
 * answer -- silently holding back every capture the device was already carrying.
 */
async function readNewSms(session: Session): Promise<void> {
  try {
    const capabilities = await RelayDeviceIngress.getCapabilities();
    const smsActive =
      capabilities.smsAvailable &&
      capabilities.smsPermissionGranted &&
      !capabilities.smsCapturePaused;
    if (smsActive) await RelayDeviceIngress.syncSmsInbox(session.user.id);
  } catch (error: unknown) {
    logMobileError("background.sms_inbox_read_failed", error, {
      code: "SMS_INBOX_READ_FAILED",
      integration: "relay-device-ingress",
      operation: "syncSmsInbox",
    });
  }
}
