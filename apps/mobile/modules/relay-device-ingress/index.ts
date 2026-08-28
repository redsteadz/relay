import { Platform } from "react-native";
import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";

import { normalizeNotificationAppChoices } from "../../lib/notification-capture";
import NativeRelayDeviceIngress, {
  type DeviceCapabilities,
  type NotificationCapturePreview,
  type SelectableNotificationApp,
} from "./src/RelayDeviceIngressModule";

export type { DeviceCapabilities, NotificationCapturePreview, SelectableNotificationApp };

let preparedCaptureGeneration: number | undefined;

function currentCaptureGeneration(): number {
  if (preparedCaptureGeneration === undefined) {
    throw new Error("Notification capture tenant is not prepared");
  }
  return preparedCaptureGeneration;
}

const unsupported: DeviceCapabilities = {
  notificationAllowedPackages: [],
  notificationCapturePaused: true,
  notificationListener: false,
  smsRead: false,
  platform: Platform.OS,
};

const RelayDeviceIngress = {
  async getCapabilities(): Promise<DeviceCapabilities> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) {
      return unsupported;
    }

    return NativeRelayDeviceIngress.getCapabilities();
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
  async enqueueCapture(tenantId: string, envelope: IngressEnvelope): Promise<void> {
    if (Platform.OS !== "android" || NativeRelayDeviceIngress === null) return;
    const parsed = ingressEnvelopeSchema.parse(envelope);
    await NativeRelayDeviceIngress.enqueueCapture(
      tenantId,
      parsed.id,
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
