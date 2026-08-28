import { requireOptionalNativeModule } from "expo";

export type NativeDeviceCapabilities = {
  notificationAllowedPackages: string[];
  notificationCapturePaused: boolean;
  notificationListener: boolean;
  smsAllowedSenders: string[];
  smsAvailable: boolean;
  smsCapturePaused: boolean;
  smsPermissionGranted: boolean;
  smsQueuedCount: number;
  platform: string;
};

type RelayDeviceIngressNativeModule = {
  getCapabilities(): Promise<NativeDeviceCapabilities>;
  openNotificationAccessSettings(): Promise<void>;
  configureNotificationCapture(
    tenantId: string,
    allowedPackages: string[],
    paused: boolean,
  ): Promise<void>;
  configureSmsCapture(tenantId: string, allowedSenders: string[], paused: boolean): Promise<void>;
  syncSmsInbox(tenantId: string): Promise<number>;
  deleteQueuedSms(tenantId: string): Promise<void>;
  enqueueCapture(
    tenantId: string,
    envelopeId: string,
    sourceKind: "notification" | "sms",
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
