import type { DeviceCapabilities } from "@/modules/relay-device-ingress";

/**
 * The permissions step of the introduction.
 *
 * One row per thing Relay has to be allowed before it can work, each one stating in a line what it
 * reads, beside the control that grants it. The line is the disclosure: it sits next to the action
 * rather than behind it, so the person reads what they are allowing before they allow it.
 *
 * App selection is not a row. Naming an application in a rule is what lets Relay read it
 * (ADR-0023), so the only thing onboarding needs is the system access the listener itself requires.
 */

export type PermissionState = "checking" | "needed" | "granted" | "restricted" | "unavailable";

export type PermissionId = "background" | "notifications";

export type PermissionRow = {
  detail: string;
  icon: string;
  id: PermissionId;
  state: PermissionState;
  title: string;
};

export type BackgroundDeliveryInput = {
  busy: boolean;
  enabled: boolean;
  restricted: boolean;
  supported: boolean;
};

export function notificationPermission(
  capabilities: DeviceCapabilities | undefined,
  readFailed: boolean,
): PermissionRow {
  // A failed read still offers the control. Opening Android's settings works whether or not Relay
  // could read the current state, and a row stuck on "checking" would leave no way forward.
  const state: PermissionState =
    capabilities === undefined
      ? readFailed
        ? "needed"
        : "checking"
      : capabilities.platform !== "android"
        ? "unavailable"
        : capabilities.notificationListener
          ? "granted"
          : "needed";
  return {
    detail: "Only from apps your rules name. Encrypted on this phone.",
    icon: "bell-outline",
    id: "notifications",
    state,
    title: "Read notifications",
  };
}

export function backgroundPermission(delivery: BackgroundDeliveryInput): PermissionRow {
  const state: PermissionState = !delivery.supported
    ? "unavailable"
    : delivery.restricted
      ? "restricted"
      : delivery.enabled
        ? "granted"
        : delivery.busy
          ? "checking"
          : "needed";
  return {
    detail:
      state === "restricted"
        ? "Android is blocking this. Allow Relay in battery settings, then try again."
        : "Keeps sorting while Relay is closed.",
    icon: "lightning-bolt-outline",
    id: "background",
    state,
    title: "Run in the background",
  };
}

/** Rows worth showing. A permission this device cannot grant is not a step. */
export function visibleRows(rows: readonly PermissionRow[]): PermissionRow[] {
  return rows.filter((row) => row.state !== "unavailable");
}

/**
 * Whether setup is done.
 *
 * Only notification access gates it, because without it Relay has nothing to read. Background
 * delivery is offered, not required: captures still upload whenever Relay is open.
 */
export function setupComplete(notifications: PermissionRow): boolean {
  return notifications.state === "granted" || notifications.state === "unavailable";
}

export function continueLabel(notifications: PermissionRow): string {
  if (setupComplete(notifications)) return "Continue";
  return notifications.state === "checking" ? "Checking access" : "Waiting for notification access";
}
