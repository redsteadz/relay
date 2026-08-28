import { requireOptionalNativeModule } from "expo";

export type DeviceCapabilities = {
  notificationAllowedPackages: string[];
  notificationCapturePaused: boolean;
  notificationListener: boolean;
  smsRead: boolean;
  platform: string;
};

type RelayDeviceIngressNativeModule = {
  getCapabilities(): Promise<DeviceCapabilities>;
  openNotificationAccessSettings(): Promise<void>;
  configureNotificationCapture(
    tenantId: string,
    allowedPackages: string[],
    paused: boolean,
  ): Promise<void>;
  enqueueCapture(
    tenantId: string,
    envelopeId: string,
    capturedAt: number,
    envelopeJson: string,
  ): Promise<void>;
  getReadyCaptures(
    tenantId: string,
    now: number,
  ): Promise<Array<{ envelopeId: string; attempts: number; envelopeJson: string }>>;
  acknowledgeCapture(tenantId: string, envelopeId: string): Promise<void>;
  failCapture(tenantId: string, envelopeId: string, terminal: boolean): Promise<void>;
  clearCaptureQueue(tenantId: string): Promise<void>;
};

export default requireOptionalNativeModule<RelayDeviceIngressNativeModule>("RelayDeviceIngress");
