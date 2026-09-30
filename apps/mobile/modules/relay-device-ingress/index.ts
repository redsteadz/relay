import Constants from "expo-constants";
import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";
import { PermissionsAndroid, Platform } from "react-native";

import buildConstants from "../../config/build.constants.json";
import { demoDeviceIngress } from "../../lib/demo/device-ingress";
import { demoModeEnabled } from "../../lib/demo/mode";
import { normalizeNotificationAppChoices } from "../../lib/notification-capture";
import NativeRelayDeviceIngress, {
  type NativeDeviceCapabilities,
  type NotificationCapturePreview,
  type SelectableNotificationApp,
  type SmsCapturePreview,
  type SmsSenderChoice,
} from "./src/RelayDeviceIngressModule";

export type RelayBuildVariant = keyof typeof buildConstants.buildVariants;
export type DeviceCapabilities = NativeDeviceCapabilities & { buildVariant: RelayBuildVariant };
export type {
  NotificationCapturePreview,
  SelectableNotificationApp,
  SmsCapturePreview,
  SmsSenderChoice,
};

const buildVariants = buildConstants.buildVariants as Record<RelayBuildVariant, RelayBuildVariant>;
const buildVariant: RelayBuildVariant =
  Constants.expoConfig?.extra?.relayBuildVariant === buildVariants.sideload
    ? buildVariants.sideload
    : buildVariants.development;

export type RetainedCaptureContent = { body?: string; subject?: string };

const RETAINED_TEXT_MAX_LENGTH = 4096;

function boundedText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= RETAINED_TEXT_MAX_LENGTH
    ? value
    : undefined;
}

/** Content the device kept for itself. Parsed defensively; a malformed row is dropped, not shown. */
function parseRetainedContent(raw: string): RetainedCaptureContent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const body = boundedText(record.body);
  const subject = boundedText(record.subject);
  if (body === undefined && subject === undefined) return undefined;
  return { ...(body === undefined ? {} : { body }), ...(subject === undefined ? {} : { subject }) };
}

let preparedCaptureGeneration: number | undefined;

function currentCaptureGeneration(): number {
  if (preparedCaptureGeneration === undefined) {
    throw new Error("Notification capture tenant is not prepared");
  }
  return preparedCaptureGeneration;
}

const unsupported: DeviceCapabilities = {
  buildVariant,
  notificationAllowedPackages: [],
  notificationCapturePaused: true,
  notificationListener: false,
  smsAllowedSenders: [],
  smsAvailable: false,
  smsCapturePaused: true,
  smsPermissionGranted: false,
  smsQueuedCount: 0,
  platform: Platform.OS,
};

/**
 * Demo builds answer every method here locally.
 *
 * The listener grant, the SMS permission and the encrypted queue are all things a demo cannot
 * arrange in front of an audience, so this is the boundary they are replaced at: everything above it
 * -- the source screens, the consent flow, the secure previews, the retained-content reads the inbox
 * depends on -- keeps calling exactly what it calls in a real build. Every demo answer comes from the
 * one stand-in in `lib/demo/device-ingress.ts`, which the device-boundary harness also installs.
 */
const RelayDeviceIngress = {
  async getCapabilities(): Promise<DeviceCapabilities> {
    if (demoModeEnabled()) {
      return { ...(await demoDeviceIngress.getCapabilities()), buildVariant };
    }
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) {
      return unsupported;
    }

    const native = await NativeRelayDeviceIngress.getCapabilities();
    return {
      ...native,
      buildVariant,
      smsAvailable: buildVariant === buildVariants.sideload && native.smsAvailable,
    };
  },
  async getSelectableNotificationApps(): Promise<SelectableNotificationApp[]> {
    if (demoModeEnabled()) return demoDeviceIngress.getSelectableNotificationApps();
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return [];
    return normalizeNotificationAppChoices(
      await NativeRelayDeviceIngress.getSelectableNotificationApps(),
    );
  },
  async openNotificationAccessSettings(): Promise<void> {
    if (demoModeEnabled()) return demoDeviceIngress.openNotificationAccessSettings();
    if (Platform.OS === "android" && NativeRelayDeviceIngress !== null) {
      await NativeRelayDeviceIngress.openNotificationAccessSettings();
    }
  },
  async configureNotificationCapture(
    tenantId: string,
    allowedPackages: string[],
    paused: boolean,
  ): Promise<void> {
    if (demoModeEnabled()) {
      return demoDeviceIngress.configureNotificationCapture(tenantId, allowedPackages, paused);
    }
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.configureNotificationCapture(
      tenantId,
      allowedPackages,
      paused,
      currentCaptureGeneration(),
    );
  },
  /**
   * Reads the device's own copy of what the given captures said.
   *
   * The server keeps derived facts and destroys the encrypted original after seven days, so this is
   * what lets an item still show its content afterwards. Values are decrypted from Keystore-backed
   * storage on demand and are never written to JavaScript storage or sent anywhere.
   */
  async getRetainedCaptureContent(
    tenantId: string,
    envelopeIds: readonly string[],
  ): Promise<Record<string, RetainedCaptureContent>> {
    if (demoModeEnabled())
      return demoDeviceIngress.getRetainedCaptureContent(tenantId, envelopeIds);
    if (
      Platform.OS !== "android" ||
      NativeRelayDeviceIngress === null ||
      envelopeIds.length === 0
    ) {
      return {};
    }
    const rows = await NativeRelayDeviceIngress.getRetainedCaptureContent(
      tenantId,
      [...envelopeIds],
      currentCaptureGeneration(),
    );
    const content: Record<string, RetainedCaptureContent> = {};
    for (const [envelopeId, raw] of Object.entries(rows)) {
      const parsed = parseRetainedContent(raw);
      if (parsed !== undefined) content[envelopeId] = parsed;
    }
    return content;
  },
  async prepareNotificationCaptureState(
    tenantId: string | undefined,
    cleanupTenantId: string | undefined,
    generation: number,
  ): Promise<void> {
    if (demoModeEnabled()) {
      preparedCaptureGeneration = generation;
      return;
    }
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.prepareNotificationCaptureState(
      tenantId ?? null,
      cleanupTenantId ?? null,
      generation,
    );
    if (preparedCaptureGeneration === undefined || generation > preparedCaptureGeneration) {
      preparedCaptureGeneration = generation;
    }
  },
  async requestSmsPermissions(): Promise<boolean> {
    if (demoModeEnabled()) return demoDeviceIngress.requestSmsPermissions();
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return false;
    const capabilities = await this.getCapabilities();
    if (!capabilities.smsAvailable) return false;
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    return (
      results[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED
    );
  },
  async configureSmsCapture(
    tenantId: string,
    allowedSenders: string[],
    paused: boolean,
  ): Promise<void> {
    if (demoModeEnabled()) {
      return demoDeviceIngress.configureSmsCapture(tenantId, allowedSenders, paused);
    }
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.configureSmsCapture(
      tenantId,
      allowedSenders,
      paused,
      currentCaptureGeneration(),
    );
  },
  async pickSmsSender(): Promise<SmsSenderChoice | undefined> {
    if (demoModeEnabled()) return demoDeviceIngress.pickSmsSender();
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return undefined;
    return (await NativeRelayDeviceIngress.pickSmsSender()) ?? undefined;
  },
  async syncSmsInbox(tenantId: string): Promise<number> {
    if (demoModeEnabled()) return demoDeviceIngress.syncSmsInbox(tenantId);
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return 0;
    return NativeRelayDeviceIngress.syncSmsInbox(tenantId, currentCaptureGeneration());
  },
  async deleteQueuedSms(tenantId: string): Promise<void> {
    if (demoModeEnabled()) return demoDeviceIngress.deleteQueuedSms(tenantId);
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.deleteQueuedSms(tenantId, currentCaptureGeneration());
  },
  async enqueueCapture(tenantId: string, envelope: IngressEnvelope): Promise<void> {
    if (demoModeEnabled()) return demoDeviceIngress.enqueueCapture(tenantId, envelope);
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    const parsed = ingressEnvelopeSchema.parse(envelope);
    if (parsed.source.kind !== "notification" && parsed.source.kind !== "sms") {
      throw new Error("device_capture_source_invalid");
    }
    await NativeRelayDeviceIngress.enqueueCapture(
      tenantId,
      parsed.id,
      parsed.source.kind,
      Date.parse(parsed.capturedAt),
      JSON.stringify(parsed),
      currentCaptureGeneration(),
    );
  },
  async getReadyCaptures(tenantId: string, now = Date.now()) {
    if (demoModeEnabled()) return demoDeviceIngress.getReadyCaptures(tenantId, now);
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return [];
    const rows = await NativeRelayDeviceIngress.getReadyCaptures(
      tenantId,
      now,
      currentCaptureGeneration(),
    );
    return rows.map((row) => ({
      attempts: row.attempts,
      envelope: ingressEnvelopeSchema.parse(JSON.parse(row.envelopeJson)),
    }));
  },
  async getNotificationCapturePreviews(
    tenantId: string,
    now = Date.now(),
  ): Promise<NotificationCapturePreview[]> {
    if (demoModeEnabled()) return demoDeviceIngress.getNotificationCapturePreviews(tenantId, now);
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return [];
    return NativeRelayDeviceIngress.getNotificationCapturePreviews(
      tenantId,
      now,
      currentCaptureGeneration(),
    );
  },
  async getSmsCapturePreviews(tenantId: string, now = Date.now()): Promise<SmsCapturePreview[]> {
    if (demoModeEnabled()) return demoDeviceIngress.getSmsCapturePreviews(tenantId, now);
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return [];
    return NativeRelayDeviceIngress.getSmsCapturePreviews(
      tenantId,
      now,
      currentCaptureGeneration(),
    );
  },
  async setCapturePreviewSecure(enabled: boolean): Promise<void> {
    if (demoModeEnabled()) return demoDeviceIngress.setCapturePreviewSecure(enabled);
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.setCapturePreviewSecure(enabled);
  },
  async acknowledgeCapture(tenantId: string, envelopeId: string): Promise<void> {
    if (demoModeEnabled()) return demoDeviceIngress.acknowledgeCapture(tenantId, envelopeId);
    await NativeRelayDeviceIngress?.acknowledgeCapture(
      tenantId,
      envelopeId,
      currentCaptureGeneration(),
    );
  },
  async failCapture(tenantId: string, envelopeId: string, terminal: boolean): Promise<void> {
    if (demoModeEnabled()) return demoDeviceIngress.failCapture(tenantId, envelopeId, terminal);
    await NativeRelayDeviceIngress?.failCapture(
      tenantId,
      envelopeId,
      terminal,
      currentCaptureGeneration(),
    );
  },
  async clearCaptureQueue(tenantId: string): Promise<void> {
    if (demoModeEnabled()) return demoDeviceIngress.clearCaptureQueue(tenantId);
    if (NativeRelayDeviceIngress === null) return;
    const generation = currentCaptureGeneration();
    await NativeRelayDeviceIngress.clearCaptureQueue(tenantId, generation);
    if (preparedCaptureGeneration === generation) preparedCaptureGeneration = undefined;
  },
};

export default RelayDeviceIngress;
