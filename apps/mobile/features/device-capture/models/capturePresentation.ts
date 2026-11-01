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

export type CaptureSwitchCopy = { detail?: string; hint?: string; label: string };

const SWITCH_COPY: Record<
  "notifications" | "sms",
  Record<CaptureControlIntent, CaptureSwitchCopy>
> = {
  notifications: {
    authorize: {
      detail: "Android has not given Relay notification access.",
      hint: "Opens the consent notice, then Android's access settings",
      label: "No access",
    },
    pause: {
      detail: "Capturing. Changes apply before the next item enters the encrypted queue.",
      hint: "Stops capturing new notifications immediately",
      label: "Capturing",
    },
    resume: {
      detail: "Paused. Nothing new is captured, and what was already queued is untouched.",
      hint: "Opens the consent notice before capture resumes",
      label: "Paused",
    },
  },
  sms: {
    authorize: {
      detail: "Android has not given Relay SMS access.",
      hint: "Opens the consent notice, then asks Android for SMS access",
      label: "No access",
    },
    pause: {
      detail: "Capturing. Changes apply before any new SMS enters the encrypted queue.",
      hint: "Stops capturing new messages immediately",
      label: "Capturing",
    },
    resume: {
      detail: "Paused. Nothing new is captured, and what was already queued is untouched.",
      hint: "Opens the consent notice before capture resumes",
      label: "Paused",
    },
  },
};

/**
 * What a source's capture switch says, keyed by what turning it would do.
 *
 * "Paused" is something the reader chose. Without Android's access there was nothing to choose, so
 * the switch says "No access", matching the status label above it, rather than implying a pause the
 * reader never made. Before the first capability read it claims neither, and where the source cannot
 * run at all the notice beside the switch says why.
 */
export function captureSwitchCopy(
  source: "notifications" | "sms",
  intent: CaptureControlIntent | "unavailable" | undefined,
): CaptureSwitchCopy {
  if (intent === undefined) return { label: "Checking access" };
  if (intent === "unavailable") return { label: "Unavailable" };
  return SWITCH_COPY[source][intent];
}
