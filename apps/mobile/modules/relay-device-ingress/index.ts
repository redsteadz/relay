import { Platform } from "react-native";
import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";

import NativeRelayDeviceIngress, { type DeviceCapabilities } from "./src/RelayDeviceIngressModule";

export type { DeviceCapabilities };

const unsupported: DeviceCapabilities = {
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
  async openNotificationAccessSettings(): Promise<void> {
    if (Platform.OS === "android" && NativeRelayDeviceIngress !== null) {
      await NativeRelayDeviceIngress.openNotificationAccessSettings();
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
