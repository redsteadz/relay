import { useState } from "react";

import { isValidNotificationAllowlist } from "@/lib/notification-capture";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

import { notificationControlIntent } from "../models/capturePresentation";
import { useDeviceCaptureCapabilities } from "./useDeviceCaptureCapabilities";

export function useNotificationCaptureController() {
  const capture = useDeviceCaptureCapabilities();
  const [busy, setBusy] = useState(false);
  const [consentVisible, setConsentVisible] = useState(false);
  const [message, setMessage] = useState<string>();
  const capabilities = capture.capabilities;
  const intent = capabilities === undefined ? "authorize" : notificationControlIntent(capabilities);

  async function configure(paused: boolean) {
    if (
      capture.mode.tenantId === undefined ||
      capabilities === undefined ||
      !isValidNotificationAllowlist(capabilities.notificationAllowedPackages)
    ) {
      setMessage("Choose at least one app before updating notification capture.");
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
      if (await configure(true)) setMessage("Notification capture paused.");
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
        setMessage("Notification capture resumed.");
      }
    } catch (error: unknown) {
      logMobileError(
        intent === "authorize"
          ? "capture.notification_access_open_failed"
          : "capture.notification_state_update_failed",
        error,
        {
          code:
            intent === "authorize"
              ? "NOTIFICATION_ACCESS_OPEN_FAILED"
              : "NOTIFICATION_CAPTURE_STATE_FAILED",
          integration: "relay-device-ingress",
          operation:
            intent === "authorize"
              ? "openNotificationAccessSettings"
              : "setNotificationCapturePaused",
        },
      );
      setMessage(
        intent === "authorize"
          ? "Could not open Android notification access settings."
          : "Could not resume notification capture.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openSystemSettings() {
    setMessage(undefined);
    try {
      await RelayDeviceIngress.openNotificationAccessSettings();
    } catch (error: unknown) {
      logMobileError("capture.notification_access_open_failed", error, {
        code: "NOTIFICATION_ACCESS_OPEN_FAILED",
        integration: "relay-device-ingress",
        operation: "openNotificationAccessSettings",
      });
      setMessage("Could not open Android notification access settings.");
    }
  }

  return {
    ...capture,
    busy,
    closeConsent: () => setConsentVisible(false),
    confirmConsent,
    consentVisible,
    intent,
    message,
    openConsent: () => setConsentVisible(true),
    openSystemSettings,
    pause,
  };
}
