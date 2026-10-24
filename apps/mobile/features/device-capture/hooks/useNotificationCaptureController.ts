import { useState } from "react";

import type { MessageTone } from "@/components/ui/component-state";
import { isValidNotificationAllowlist } from "@/lib/notification-capture";
import { logMobileError, runInBackground } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

import { notificationControlIntent } from "../models/capturePresentation";
import { useDeviceCaptureCapabilities } from "./useDeviceCaptureCapabilities";

export function useNotificationCaptureController() {
  const capture = useDeviceCaptureCapabilities();
  const [busy, setBusy] = useState(false);
  const [consentVisible, setConsentVisible] = useState(false);
  const [message, setMessageState] = useState<{ text: string; tone: MessageTone }>();
  // The tone is decided where the message is written. Inferring it from the wording read "access
  // was not granted. Capture remains paused." as a success because it contains "paused".
  const setMessage = (text: string | undefined, tone: MessageTone = "error") =>
    setMessageState(text === undefined ? undefined : { text, tone });
  const capabilities = capture.capabilities;
  const intent = capabilities === undefined ? "authorize" : notificationControlIntent(capabilities);

  async function configure(paused: boolean) {
    if (
      capture.mode.tenantId === undefined ||
      capabilities === undefined ||
      !isValidNotificationAllowlist(capabilities.notificationAllowedPackages)
    ) {
      setMessage("Choose at least one app before updating notification capture.", "warning");
      return false;
    }
    await RelayDeviceIngress.configureNotificationCapture(
      capture.mode.tenantId,
      capabilities.notificationAllowedPackages,
      paused,
    );
    await capture.refresh();
    return true;
  }

  async function pause() {
    setBusy(true);
    setMessage(undefined);
    try {
      if (await configure(true)) setMessage("Notification capture paused.", "success");
    } catch (error: unknown) {
      logMobileError("capture.notification_state_update_failed", error, {
        code: "NOTIFICATION_CAPTURE_STATE_FAILED",
        integration: "relay-device-ingress",
        operation: "setNotificationCapturePaused",
      });
      setMessage("Could not pause notification capture.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmConsent() {
    setBusy(true);
    setMessage(undefined);
    try {
      if (intent === "authorize") {
        if (!(await configure(true))) return;
        setConsentVisible(false);
        await RelayDeviceIngress.openNotificationAccessSettings();
        return;
      }
      if (await configure(false)) {
        setConsentVisible(false);
        setMessage("Notification capture resumed.", "success");
      }
    } catch (error: unknown) {
      logMobileError("capture.notification_consent_failed", error, {
        code: "NOTIFICATION_CONSENT_FAILED",
        integration: "relay-device-ingress",
        operation: "confirmNotificationCaptureConsent",
      });
      setMessage(
        intent === "authorize"
          ? "Could not open Android notification access settings."
          : "Could not resume notification capture.",
      );
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
    openSystemSettings: () =>
      runInBackground(
        RelayDeviceIngress.openNotificationAccessSettings(),
        "capture.notification_access_open_failed",
        {
          code: "NOTIFICATION_ACCESS_OPEN_FAILED",
          integration: "relay-device-ingress",
          operation: "openNotificationAccessSettings",
        },
      ),
    pause,
  };
}
