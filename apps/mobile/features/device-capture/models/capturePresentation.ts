import type { DeviceCapabilities } from "@/modules/relay-device-ingress";

export type SourceStatusTone = "accent" | "danger" | "muted" | "success" | "warning";

export type SourceStatus = {
  icon: string;
  label: string;
  tone: SourceStatusTone;
};

const loadingStatus: SourceStatus = {
  icon: "progress-clock",
  label: "Loading",
  tone: "muted",
};

export const gmailStatus: SourceStatus = {
  icon: "clock-outline",
  label: "Not connected",
  tone: "muted",
};

export function notificationStatus(capabilities: DeviceCapabilities | undefined): SourceStatus {
  if (capabilities === undefined) return loadingStatus;
  if (capabilities.platform !== "android") {
    return { icon: "cellphone-off", label: "Unsupported", tone: "warning" };
  }
  if (!capabilities.notificationListener) {
    return { icon: "alert-circle-outline", label: "No access", tone: "warning" };
  }
  return capabilities.notificationCapturePaused
    ? { icon: "pause-circle-outline", label: "Paused", tone: "warning" }
    : { icon: "check-circle-outline", label: "Active", tone: "success" };
}

export function smsStatus(capabilities: DeviceCapabilities | undefined): SourceStatus {
  if (capabilities === undefined) return loadingStatus;
  if (!capabilities.smsAvailable) {
    return { icon: "minus-circle-outline", label: "NOT IN THIS BUILD", tone: "warning" };
  }
  if (!capabilities.smsPermissionGranted) {
    return { icon: "alert-circle-outline", label: "No access", tone: "warning" };
  }
  return capabilities.smsCapturePaused
    ? { icon: "pause-circle-outline", label: "Paused", tone: "warning" }
    : { icon: "check-circle-outline", label: "Active", tone: "success" };
}

export type CaptureControlIntent = "authorize" | "pause" | "resume";

export function notificationControlIntent(capabilities: DeviceCapabilities): CaptureControlIntent {
  if (!capabilities.notificationListener) return "authorize";
  return capabilities.notificationCapturePaused ? "resume" : "pause";
}

export function smsControlIntent(capabilities: DeviceCapabilities): CaptureControlIntent {
  if (!capabilities.smsPermissionGranted) return "authorize";
  return capabilities.smsCapturePaused ? "resume" : "pause";
}
