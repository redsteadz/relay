import Constants from "expo-constants";
import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";
import { PermissionsAndroid, Platform } from "react-native";

import buildConstants from "../../config/build.constants.json";
import NativeRelayDeviceIngress, {
  type NativeDeviceCapabilities,
} from "./src/RelayDeviceIngressModule";

export type RelayBuildVariant = keyof typeof buildConstants.buildVariants;
export type DeviceCapabilities = NativeDeviceCapabilities & { buildVariant: RelayBuildVariant };

const buildVariants = buildConstants.buildVariants as Record<RelayBuildVariant, RelayBuildVariant>;
const buildVariant: RelayBuildVariant =
  Constants.expoConfig?.extra?.relayBuildVariant === buildVariants.sideload
    ? buildVariants.sideload
    : buildVariants.development;

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
    await NativeRelayDeviceIngress.configureNotificationCapture(tenantId, allowedPackages, paused);
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
    await NativeRelayDeviceIngress.configureSmsCapture(tenantId, allowedSenders, paused);
  },
  async syncSmsInbox(tenantId: string): Promise<number> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return 0;
    return NativeRelayDeviceIngress.syncSmsInbox(tenantId);
  },
  async deleteQueuedSms(tenantId: string): Promise<void> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    await NativeRelayDeviceIngress.deleteQueuedSms(tenantId);
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
    );
  },
  async getReadyCaptures(tenantId: string, now = Date.now()) {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return [];
    const rows = await NativeRelayDeviceIngress.getReadyCaptures(tenantId, now);
    return rows.map((row) => ({
      attempts: row.attempts,
      envelope: ingressEnvelopeSchema.parse(JSON.parse(row.envelopeJson)),
    }));
  },
  async acknowledgeCapture(tenantId: string, envelopeId: string): Promise<void> {
    await NativeRelayDeviceIngress?.acknowledgeCapture(tenantId, envelopeId);
  },
  async failCapture(tenantId: string, envelopeId: string, terminal: boolean): Promise<void> {
    await NativeRelayDeviceIngress?.failCapture(tenantId, envelopeId, terminal);
  },
  async clearCaptureQueue(tenantId: string): Promise<void> {
    await NativeRelayDeviceIngress?.clearCaptureQueue(tenantId);
  },
};

export default RelayDeviceIngress;
