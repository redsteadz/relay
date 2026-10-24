import { useState } from "react";

import type { MessageTone } from "@/components/ui/component-state";
import { enableSmsCapture, isValidSmsSenderAllowlist } from "@/lib/sms-capture";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

import { smsControlIntent } from "../models/capturePresentation";
import { useDeviceCaptureCapabilities } from "./useDeviceCaptureCapabilities";

export function useSmsCaptureController() {
  const capture = useDeviceCaptureCapabilities();
  const [busy, setBusy] = useState(false);
  const [consentVisible, setConsentVisible] = useState(false);
  const [message, setMessageState] = useState<{ text: string; tone: MessageTone }>();
  // The tone is decided where the message is written. Inferring it from the wording read "access
  // was not granted. Capture remains paused." as a success because it contains "paused".
  const setMessage = (text: string | undefined, tone: MessageTone = "error") =>
    setMessageState(text === undefined ? undefined : { text, tone });
  const capabilities = capture.capabilities;
  const intent = capabilities === undefined ? "authorize" : smsControlIntent(capabilities);

  async function pause() {
    if (
      capture.mode.tenantId === undefined ||
      capabilities === undefined ||
      !isValidSmsSenderAllowlist(capabilities.smsAllowedSenders)
    ) {
      setMessage("Choose at least one contact before updating SMS capture.", "warning");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await RelayDeviceIngress.configureSmsCapture(
        capture.mode.tenantId,
        capabilities.smsAllowedSenders,
        true,
      );
      await capture.refresh();
      setMessage("SMS capture paused.", "success");
    } catch (error: unknown) {
      logMobileError("capture.sms_pause_update_failed", error, {
        code: "SMS_CAPTURE_STATE_FAILED",
        integration: "relay-device-ingress",
        operation: "setSmsCapturePaused",
      });
      setMessage("Could not pause SMS capture.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmConsent() {
    const tenantId = capture.mode.tenantId;
    if (
      tenantId === undefined ||
      capabilities === undefined ||
      !capabilities.smsAvailable ||
      !isValidSmsSenderAllowlist(capabilities.smsAllowedSenders)
    ) {
      setMessage("Choose at least one contact before enabling SMS capture.", "warning");
      return;
    }

    setBusy(true);
    setMessage(undefined);
    try {
      const result = await enableSmsCapture({
        configure: (paused) =>
          RelayDeviceIngress.configureSmsCapture(tenantId, capabilities.smsAllowedSenders, paused),
        permissionGranted: capabilities.smsPermissionGranted,
        requestPermissions: () => RelayDeviceIngress.requestSmsPermissions(),
        syncInbox: () => RelayDeviceIngress.syncSmsInbox(tenantId),
      });
      setConsentVisible(false);
      await capture.refresh();
      setMessage(
        result.granted
          ? `SMS capture enabled. ${result.captured.toString()} matching messages queued.`
          : "SMS access was not granted. Capture remains paused.",
        result.granted ? "success" : "warning",
      );
    } catch (error: unknown) {
      logMobileError("capture.sms_enable_failed", error, {
        code: "SMS_CAPTURE_ENABLE_FAILED",
        integration: "relay-device-ingress",
        operation: "enableSmsCapture",
      });
      setMessage("Could not enable SMS capture.");
    } finally {
      setBusy(false);
    }
  }

  return {
    ...capture,
    busy,
    closeConsent: () => setConsentVisible(false),
    confirmConsent,
    consentVisible,
    intent,
    message: message?.text,
    messageTone: message?.tone,
    openConsent: () => setConsentVisible(true),
    pause,
  };
}
