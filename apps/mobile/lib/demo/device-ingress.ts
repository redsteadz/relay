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
 *
 * The listener and the queue are modelled too. `demoPostNotification` applies the native listener's
 * gates and `NotificationCapturePolicy.decide`, builds the envelope the way
 * `NotificationEnvelopeFactory` does, and queues it with the native queue's semantics. What it cannot
 * model is the Kotlin itself or the Keystore encryption of the queue: those stay covered by the
 * module's JUnit tests. The device-boundary harness (`e2e/device-boundary.e2e.ts`) drives this
 * stand-in in place of the native module; a demo build still never uploads what it queues.
 */

import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";

import buildConstants from "../../config/build.constants.json";
import type {
  NotificationCapturePreview,
  SelectableNotificationApp,
  SmsCapturePreview,
} from "../../modules/relay-device-ingress/src/RelayDeviceIngressModule";
import { CAPTURE_QUEUE_MAX_AGE_MS, type QueuedCapture } from "../capture-queue";
import { normalizeNotificationAppChoices } from "../notification-capture";
import { demoUuid } from "./ids";
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

/**
 * Stores what the listener may capture, and for whom.
 *
 * The native listener reads its tenant from this configuration rather than from the signed-in
 * session, so the tenant is kept alongside the allowlist here too.
 */
export async function demoConfigureNotificationCapture(
  allowedPackages: readonly string[],
  paused: boolean,
  tenantId?: string,
): Promise<void> {
  await demoDatabase.ready();
  const current = settings();
  current.notification_allowed_packages = [...allowedPackages];
  current.notification_capture_paused = paused;
  if (tenantId !== undefined) current.tenant_id = tenantId;
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

export type DemoRetainedContent = { body?: string; subject?: string };

/** The device's own copy of what these captures said, as the module's retained-content read returns it. */
export async function demoRetainedContent(
  envelopeIds: readonly string[],
): Promise<Record<string, DemoRetainedContent>> {
  await demoDatabase.ready();
  const wanted = new Set(envelopeIds);
  const content: Record<string, DemoRetainedContent> = {};
  for (const row of demoDatabase.rows("retained_content")) {
    const id = row.source_item_id;
    if (typeof id !== "string" || !wanted.has(id)) continue;
    const body = typeof row.body === "string" && row.body.length > 0 ? row.body : undefined;
    const subject =
      typeof row.subject === "string" && row.subject.length > 0 ? row.subject : undefined;
    if (body === undefined && subject === undefined) continue;
    content[id] = {
      ...(body === undefined ? {} : { body }),
      ...(subject === undefined ? {} : { subject }),
    };
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

/** Android's `Notification.FLAG_GROUP_SUMMARY`. */
export const NOTIFICATION_FLAG_GROUP_SUMMARY = 0x200;

/** The package Relay itself posts from. The native listener never captures its own notifications. */
const RELAY_PACKAGE = buildConstants.app.androidApplicationId;

/** `NotificationEnvelopeFactory` bounds. Visible title and text are the only strings read. */
const MAX_TEXT_LENGTH = 4096;
const MAX_SENDER_LENGTH = 1024;

/** `CaptureQueueStore.ready` hands the drain at most this many rows per snapshot. */
const READY_LIMIT = 50;

/** What a listener sees of one posted notification: the fields the native factory reads. */
export type DemoPostedNotification = {
  flags?: number | undefined;
  key: string;
  /** The structured `MessagingStyle` sender, when the posting app supplied one. */
  messagingSender?: string | undefined;
  packageName: string;
  /** `StatusBarNotification.postTime`, in epoch milliseconds. */
  postedAt: number;
  text?: string | undefined;
  title?: string | undefined;
};

/**
 * Why the listener did or did not capture a notification.
 *
 * The first three are the service's own gates; the rest are `NotificationCapturePolicy.decide`, in
 * the order it applies them.
 */
export type DemoCaptureDecision =
  | "listener-disabled"
  | "not-configured"
  | "paused"
  | "own-notification"
  | "group-summary"
  | "package-not-allowed"
  | "capture";

function visible(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * The envelope `NotificationEnvelopeFactory.create` would build.
 *
 * Identity follows ADR-0011: package, key and the visible content, never the post time, so an
 * unchanged redelivery keeps its id and an edit becomes its own capture. The id is derived with
 * `demoUuid` rather than the native name-based UUID, which is enough for a stand-in: what callers
 * depend on is that it is stable, not which hash produced it.
 */
function notificationEnvelope(
  notification: DemoPostedNotification,
  capturedAt: number,
): { content: DemoRetainedContent; envelope: IngressEnvelope } {
  const subject = notification.title?.slice(0, MAX_TEXT_LENGTH);
  const body = notification.text?.slice(0, MAX_TEXT_LENGTH);
  const trimmedSender = notification.messagingSender?.trim();
  const sender =
    trimmedSender === undefined || trimmedSender.length === 0
      ? undefined
      : trimmedSender.slice(0, MAX_SENDER_LENGTH);
  const id = demoUuid(
    [
      "notification",
      notification.packageName,
      notification.key,
      [subject ?? "", body ?? "", sender ?? ""].join("\u0000"),
    ].join(" "),
  );
  const envelope = ingressEnvelopeSchema.parse({
    schemaVersion: 1,
    id,
    occurredAt: new Date(notification.postedAt).toISOString(),
    capturedAt: new Date(capturedAt).toISOString(),
    // The native adapter has no provider message id, so the envelope id is also the external id.
    source: { applicationId: notification.packageName, externalId: id, kind: "notification" },
    // A sender only when Android structurally identified one, and never as a top-level field.
    attributes: sender === undefined ? {} : { sender },
    ...(visible(subject) ? { subject } : {}),
    ...(visible(body) ? { body } : {}),
  });
  return {
    content: {
      ...(visible(body) ? { body } : {}),
      ...(visible(subject) ? { subject } : {}),
    },
    envelope,
  };
}

/** Queues one envelope. A redelivery keeps the original row and its attempt count. */
function enqueue(tenantId: string, envelope: IngressEnvelope, now: number): void {
  const rows = demoDatabase.rows("capture_queue");
  if (rows.some((row) => row.tenant_id === tenantId && row.envelope_id === envelope.id)) return;
  rows.push({
    attempts: 0,
    captured_at: envelope.capturedAt,
    envelope_id: envelope.id,
    envelope_json: JSON.stringify(envelope),
    expires_at: Math.min(Date.parse(envelope.capturedAt), now) + CAPTURE_QUEUE_MAX_AGE_MS,
    source_kind: envelope.source.kind,
    state: "pending",
    tenant_id: tenantId,
  });
}

function retain(tenantId: string, envelopeId: string, content: DemoRetainedContent): void {
  if (content.body === undefined && content.subject === undefined) return;
  const rows = demoDatabase.rows("retained_content");
  const row = {
    body: content.body ?? null,
    source_item_id: envelopeId,
    subject: content.subject ?? null,
    user_id: tenantId,
  };
  const existing = rows.find((candidate) => candidate.source_item_id === envelopeId);
  if (existing === undefined) rows.unshift(row);
  else Object.assign(existing, row);
}

/**
 * Hears one notification, as the native listener service would.
 *
 * The gates run in the service's order: listener access, a stored configuration naming the tenant,
 * the pause flag, then the policy -- Relay's own package, group summaries, and the allowlist. A
 * notification that passes is queued, and a copy of what it said is kept for the inbox.
 */
export async function demoPostNotification(
  notification: DemoPostedNotification,
  now = Date.now(),
): Promise<{ decision: DemoCaptureDecision; envelopeId?: string }> {
  await demoDatabase.ready();
  const current = settings();
  if (current.notification_listener !== true) return { decision: "listener-disabled" };
  const tenantId = current.tenant_id;
  if (typeof tenantId !== "string" || tenantId.length === 0) return { decision: "not-configured" };
  if (current.notification_capture_paused === true) return { decision: "paused" };
  if (notification.packageName === RELAY_PACKAGE) return { decision: "own-notification" };
  if (((notification.flags ?? 0) & NOTIFICATION_FLAG_GROUP_SUMMARY) !== 0) {
    return { decision: "group-summary" };
  }
  if (!stringList(current.notification_allowed_packages).includes(notification.packageName)) {
    return { decision: "package-not-allowed" };
  }

  const captured = notificationEnvelope(notification, now);
  enqueue(tenantId, captured.envelope, now);
  retain(tenantId, captured.envelope.id, captured.content);
  demoDatabase.touch();
  return { decision: "capture", envelopeId: captured.envelope.id };
}

/** The module's `enqueueCapture`: an envelope built elsewhere, queued without a retained copy. */
export async function demoEnqueueCapture(
  tenantId: string,
  envelope: IngressEnvelope,
): Promise<void> {
  await demoDatabase.ready();
  const parsed = ingressEnvelopeSchema.parse(envelope);
  if (parsed.source.kind !== "notification" && parsed.source.kind !== "sms") {
    throw new Error("device_capture_source_invalid");
  }
  enqueue(tenantId, parsed, Date.now());
  demoDatabase.touch();
}

/**
 * One snapshot of what is waiting to upload, oldest first.
 *
 * Parsed the way the module parses the native rows, so one unreadable row rejects the snapshot here
 * exactly as it does on a device.
 */
export async function demoReadyCaptures(
  tenantId: string,
  now = Date.now(),
): Promise<QueuedCapture[]> {
  await demoDatabase.ready();
  return demoDatabase
    .rows("capture_queue")
    .filter(
      (row) =>
        row.tenant_id === tenantId &&
        row.state === "pending" &&
        typeof row.expires_at === "number" &&
        row.expires_at > now,
    )
    .sort(
      (left, right) =>
        Date.parse(left.captured_at as string) - Date.parse(right.captured_at as string),
    )
    .slice(0, READY_LIMIT)
    .map((row) => ({
      attempts: row.attempts as number,
      envelope: ingressEnvelopeSchema.parse(JSON.parse(row.envelope_json as string)),
    }));
}

/** An acknowledged capture leaves the queue; nothing else removes one. */
export async function demoAcknowledgeCapture(tenantId: string, envelopeId: string): Promise<void> {
  await demoDatabase.ready();
  demoDatabase.replace(
    "capture_queue",
    demoDatabase
      .rows("capture_queue")
      .filter((row) => row.tenant_id !== tenantId || row.envelope_id !== envelopeId),
  );
  demoDatabase.touch();
}

/** Records an attempt. A terminal failure stops the row being offered again. */
export async function demoFailCapture(
  tenantId: string,
  envelopeId: string,
  terminal: boolean,
): Promise<void> {
  await demoDatabase.ready();
  const row = demoDatabase
    .rows("capture_queue")
    .find((candidate) => candidate.tenant_id === tenantId && candidate.envelope_id === envelopeId);
  if (row === undefined) return;
  row.attempts = (row.attempts as number) + 1;
  row.state = terminal ? "failed" : "pending";
  demoDatabase.touch();
}

/** Drops this tenant's queued captures, as sign-out and account deletion do. */
export async function demoClearCaptureQueue(tenantId: string): Promise<void> {
  await demoDatabase.ready();
  demoDatabase.replace(
    "capture_queue",
    demoDatabase.rows("capture_queue").filter((row) => row.tenant_id !== tenantId),
  );
  demoDatabase.touch();
}

/**
 * The device capture module, as this stand-in answers it.
 *
 * `modules/relay-device-ingress` delegates here in a demo build, and the device-boundary harness
 * installs this object in that module's place. Either way there is one stand-in for the native side,
 * not one per caller. Capabilities carry no build variant: the module adds its own.
 */
/** The device capture module surface this stand-in answers, as its callers invoke it. */
export type DemoDeviceIngress = {
  acknowledgeCapture(tenantId: string, envelopeId: string): Promise<void>;
  clearCaptureQueue(tenantId: string): Promise<void>;
  configureNotificationCapture(
    tenantId: string,
    allowedPackages: string[],
    paused: boolean,
  ): Promise<void>;
  configureSmsCapture(tenantId: string, allowedSenders: string[], paused: boolean): Promise<void>;
  deleteQueuedSms(tenantId: string): Promise<void>;
  enqueueCapture(tenantId: string, envelope: IngressEnvelope): Promise<void>;
  failCapture(tenantId: string, envelopeId: string, terminal: boolean): Promise<void>;
  getCapabilities(): Promise<DemoNativeCapabilities>;
  getNotificationCapturePreviews(
    tenantId: string,
    now?: number,
  ): Promise<NotificationCapturePreview[]>;
  getReadyCaptures(tenantId: string, now?: number): Promise<QueuedCapture[]>;
  getRetainedCaptureContent(
    tenantId: string,
    envelopeIds: readonly string[],
  ): Promise<Record<string, DemoRetainedContent>>;
  getSelectableNotificationApps(): Promise<SelectableNotificationApp[]>;
  getSmsCapturePreviews(tenantId: string, now?: number): Promise<SmsCapturePreview[]>;
  openNotificationAccessSettings(): Promise<void>;
  pickSmsSender(): Promise<{ label: string; sender: string }>;
  prepareNotificationCaptureState(
    tenantId: string | undefined,
    cleanupTenantId: string | undefined,
    generation: number,
  ): Promise<void>;
  requestSmsPermissions(): Promise<boolean>;
  setCapturePreviewSecure(enabled: boolean): Promise<void>;
  syncSmsInbox(tenantId: string): Promise<number>;
};

export const demoDeviceIngress: DemoDeviceIngress = {
  acknowledgeCapture: demoAcknowledgeCapture,
  clearCaptureQueue: demoClearCaptureQueue,
  configureNotificationCapture: (tenantId, allowedPackages, paused) =>
    demoConfigureNotificationCapture(allowedPackages, paused, tenantId),
  // SMS settings are not tenant-scoped here: the demo has one account.
  configureSmsCapture: (_, allowedSenders, paused) =>
    demoConfigureSmsCapture(allowedSenders, paused),
  deleteQueuedSms: () => Promise.resolve(),
  enqueueCapture: demoEnqueueCapture,
  failCapture: demoFailCapture,
  getCapabilities: demoCapabilities,
  getNotificationCapturePreviews: () => demoNotificationPreviews(),
  getReadyCaptures: demoReadyCaptures,
  getRetainedCaptureContent: (_, envelopeIds) => demoRetainedContent(envelopeIds),
  getSelectableNotificationApps: async () =>
    normalizeNotificationAppChoices(await demoSelectableApps()),
  getSmsCapturePreviews: () => demoSmsPreviews(),
  // Nothing to open: the demo already holds the grant it would have asked Android for.
  openNotificationAccessSettings: () => Promise.resolve(),
  pickSmsSender: () => Promise.resolve(demoSmsSenderChoice()),
  prepareNotificationCaptureState: () => Promise.resolve(),
  requestSmsPermissions: demoGrantSmsPermission,
  setCapturePreviewSecure: () => Promise.resolve(),
  // Nothing is read from an SMS inbox in a demo; generated captures arrive through the studio.
  syncSmsInbox: () => Promise.resolve(0),
};
