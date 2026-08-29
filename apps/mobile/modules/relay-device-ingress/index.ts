import Constants from "expo-constants";
import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";
import { PermissionsAndroid, Platform } from "react-native";

import buildConstants from "../../config/build.constants.json";
import { normalizeNotificationAppChoices } from "../../lib/notification-capture";
import NativeRelayDeviceIngress, {
  type NativeDeviceCapabilities,
  type NotificationCapturePreview,
  type SelectableNotificationApp,
} from "./src/RelayDeviceIngressModule";

export type RelayBuildVariant = keyof typeof buildConstants.buildVariants;
export type DeviceCapabilities = NativeDeviceCapabilities & { buildVariant: RelayBuildVariant };
export type { NotificationCapturePreview, SelectableNotificationApp };

const buildVariants = buildConstants.buildVariants as Record<RelayBuildVariant, RelayBuildVariant>;
const buildVariant: RelayBuildVariant =
  Constants.expoConfig?.extra?.relayBuildVariant === buildVariants.sideload
    ? buildVariants.sideload
    : buildVariants.development;

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

const RelayDeviceIngress = {
  async getCapabilities(): Promise<DeviceCapabilities> {
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
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return [];
    return normalizeNotificationAppChoices(
      await NativeRelayDeviceIngress.getSelectableNotificationApps(),
    );
  },
  async openNotificationAccessSettings(): Promise<void> {
    if (Platform.OS === "android" && NativeRelayDeviceIngress !== null) {
      await NativeRelayDeviceIngress.openNotificationAccessSettings();
    }
  },
  async configureNotificationCapture(
    tenantId: string,
    allowedPackages: string[],
    paused: boolean,
  ): Promise<void> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.configureNotificationCapture(
      tenantId,
      allowedPackages,
      paused,
      currentCaptureGeneration(),
    );
  },
  async prepareNotificationCaptureState(
    tenantId: string | undefined,
    cleanupTenantId: string | undefined,
    generation: number,
  ): Promise<void> {
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
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.configureSmsCapture(
      tenantId,
      allowedSenders,
      paused,
      currentCaptureGeneration(),
    );
  },
  async syncSmsInbox(tenantId: string): Promise<number> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return 0;
    return NativeRelayDeviceIngress.syncSmsInbox(tenantId, currentCaptureGeneration());
  },
  async deleteQueuedSms(tenantId: string): Promise<void> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.deleteQueuedSms(tenantId, currentCaptureGeneration());
  },
  async enqueueCapture(tenantId: string, envelope: IngressEnvelope): Promise<void> {
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
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return [];
    return NativeRelayDeviceIngress.getNotificationCapturePreviews(
      tenantId,
      now,
      currentCaptureGeneration(),
    );
  },
  async setNotificationCapturePreviewSecure(enabled: boolean): Promise<void> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.setNotificationCapturePreviewSecure(enabled);
  },
  async acknowledgeCapture(tenantId: string, envelopeId: string): Promise<void> {
    await NativeRelayDeviceIngress?.acknowledgeCapture(
      tenantId,
      envelopeId,
      currentCaptureGeneration(),
    );
  },
  async failCapture(tenantId: string, envelopeId: string, terminal: boolean): Promise<void> {
    await NativeRelayDeviceIngress?.failCapture(
      tenantId,
      envelopeId,
      terminal,
      currentCaptureGeneration(),
    );
  },
  async clearCaptureQueue(tenantId: string): Promise<void> {
    if (NativeRelayDeviceIngress === null) return;
    const generation = currentCaptureGeneration();
    await NativeRelayDeviceIngress.clearCaptureQueue(tenantId, generation);
    if (preparedCaptureGeneration === generation) preparedCaptureGeneration = undefined;
  },
};

export default RelayDeviceIngress;
