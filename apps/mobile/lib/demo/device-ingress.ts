/**
 * The device capture module, answered locally.
 *
 * A notification listener needs a real Android grant and a real notification to hear, neither of
 * which a demo can arrange on cue. This stands in for the native module so the source screens, the
 * consent flow, the secure local previews and the retained-content reads all work, and so the Demo
 * studio can put a capture through the same path a listener would.
 *
 * Capture settings are stored rather than pretended: pausing capture, choosing which apps are
 * allowed, and granting SMS all persist, because a control that reports a state it did not keep is
 * worse than one that is absent.
 */

import type {
  NotificationCapturePreview,
  SelectableNotificationApp,
  SmsCapturePreview,
} from "../../modules/relay-device-ingress/src/RelayDeviceIngressModule";
import { demoDatabase } from "./store";
import type { DemoRow } from "./types";

export type DemoNativeCapabilities = {
  notificationAllowedPackages: string[];
  notificationCapturePaused: boolean;
  notificationListener: boolean;
  platform: string;
  smsAllowedSenders: string[];
  smsAvailable: boolean;
  smsCapturePaused: boolean;
  smsPermissionGranted: boolean;
  smsQueuedCount: number;
};

/** Apps a demo phone plausibly has. Fixed, so the selector reads the same on every device. */
const INSTALLED_APPS: readonly SelectableNotificationApp[] = [
  { label: "Amazon Shopping", packageName: "com.amazon.mShop.android.shopping" },
  { label: "British Airways", packageName: "com.britishairways.bamobile" },
  { label: "Calendar", packageName: "com.google.android.calendar" },
  { label: "Gmail", packageName: "com.google.android.gm" },
  { label: "Messages", packageName: "com.google.android.apps.messaging" },
  { label: "Outlook", packageName: "com.microsoft.office.outlook" },
  { label: "Revolut", packageName: "com.revolut.revolut" },
  { label: "Slack", packageName: "com.Slack" },
  { label: "Uber Eats", packageName: "com.ubercab.eats" },
  { label: "WhatsApp", packageName: "com.whatsapp" },
];

const DEFAULT_SETTINGS: DemoRow = {
  notification_allowed_packages: [
    "com.amazon.mShop.android.shopping",
    "com.google.android.calendar",
    "com.microsoft.office.outlook",
    "com.revolut.revolut",
    "com.Slack",
    "com.ubercab.eats",
  ],
  notification_capture_paused: false,
  notification_listener: true,
  sms_allowed_senders: [],
  sms_capture_paused: false,
  sms_permission_granted: false,
};

function settings(): DemoRow {
  const rows = demoDatabase.rows("capture_settings");
  const current = rows[0];
  if (current !== undefined) return current;
  const created = { ...DEFAULT_SETTINGS };
  rows.push(created);
  demoDatabase.touch();
  return created;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export async function demoCapabilities(): Promise<DemoNativeCapabilities> {
  await demoDatabase.ready();
  const current = settings();
  return {
    notificationAllowedPackages: stringList(current.notification_allowed_packages),
    notificationCapturePaused: current.notification_capture_paused === true,
    notificationListener: current.notification_listener === true,
    // Reported as Android so the source screens are demonstrable wherever the build runs. Nothing
    // here touches a platform API; the capability is the demo's own state.
    platform: "android",
    smsAllowedSenders: stringList(current.sms_allowed_senders),
    smsAvailable: true,
    smsCapturePaused: current.sms_capture_paused === true,
    smsPermissionGranted: current.sms_permission_granted === true,
    smsQueuedCount: 0,
  };
}

export async function demoSelectableApps(): Promise<SelectableNotificationApp[]> {
  await demoDatabase.ready();
  return [...INSTALLED_APPS];
}

export async function demoConfigureNotificationCapture(
  allowedPackages: readonly string[],
  paused: boolean,
): Promise<void> {
  await demoDatabase.ready();
  const current = settings();
  current.notification_allowed_packages = [...allowedPackages];
  current.notification_capture_paused = paused;
  demoDatabase.touch();
}

export async function demoConfigureSmsCapture(
  allowedSenders: readonly string[],
  paused: boolean,
): Promise<void> {
  await demoDatabase.ready();
  const current = settings();
  current.sms_allowed_senders = [...allowedSenders];
  current.sms_capture_paused = paused;
  demoDatabase.touch();
}

export async function demoGrantSmsPermission(): Promise<boolean> {
  await demoDatabase.ready();
  const current = settings();
  current.sms_permission_granted = true;
  demoDatabase.touch();
  return true;
}

export async function demoRetainedContent(
  envelopeIds: readonly string[],
): Promise<Record<string, string>> {
  await demoDatabase.ready();
  const wanted = new Set(envelopeIds);
  const content: Record<string, string> = {};
  for (const row of demoDatabase.rows("retained_content")) {
    const id = row.source_item_id;
    if (typeof id !== "string" || !wanted.has(id)) continue;
    content[id] = JSON.stringify({
      ...(typeof row.body === "string" ? { body: row.body } : {}),
      ...(typeof row.subject === "string" ? { subject: row.subject } : {}),
    });
  }
  return content;
}

const PREVIEW_LIMIT = 25;

async function previews(kind: "notification" | "sms"): Promise<DemoRow[]> {
  await demoDatabase.ready();
  const retained = new Map(
    demoDatabase.rows("retained_content").map((row) => [row.source_item_id as string, row]),
  );
  return demoDatabase
    .rows("source_items")
    .filter((row) => row.source === kind)
    .slice(0, PREVIEW_LIMIT)
    .map((row) => ({ item: row, retained: retained.get(row.id as string) }));
}

export async function demoNotificationPreviews(): Promise<NotificationCapturePreview[]> {
  return (await previews("notification")).map((entry) => {
    const item = entry.item as DemoRow;
    const content = entry.retained as DemoRow | undefined;
    return {
      ...(typeof item.application_id === "string" ? { applicationId: item.application_id } : {}),
      attempts: 0,
      ...(typeof content?.body === "string" ? { body: content.body } : {}),
      capturedAt: item.created_at as string,
      envelopeId: item.id as string,
      ...(typeof item.sender === "string" ? { sender: item.sender } : {}),
      ...(typeof content?.subject === "string" ? { subject: content.subject } : {}),
    };
  });
}

export async function demoSmsPreviews(): Promise<SmsCapturePreview[]> {
  return (await previews("sms")).map((entry) => {
    const item = entry.item as DemoRow;
    const content = entry.retained as DemoRow | undefined;
    return {
      attempts: 0,
      ...(typeof content?.body === "string" ? { body: content.body } : {}),
      capturedAt: item.created_at as string,
      envelopeId: item.id as string,
      ...(typeof item.sender === "string" ? { sender: item.sender } : {}),
    };
  });
}

/** A sender the contact picker would have returned. Synthetic, like everything else here. */
export function demoSmsSenderChoice(): { label: string; sender: string } {
  return { label: "HSBC", sender: "HSBC" };
}
