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

export type SelectableNotificationApp = {
  label: string;
  packageName: string;
};

export type NotificationCapturePreview = {
  applicationId?: string;
  attempts: number;
  body?: string;
  capturedAt: string;
  envelopeId: string;
  sender?: string;
  subject?: string;
};

export type SmsCapturePreview = {
  attempts: number;
  body?: string;
  capturedAt: string;
  envelopeId: string;
  sender?: string;
};

export type SmsSenderChoice = {
  label: string;
  sender: string;
};

type RelayDeviceIngressNativeModule = {
  getCapabilities(): Promise<NativeDeviceCapabilities>;
  getSelectableNotificationApps(): Promise<SelectableNotificationApp[]>;
  openNotificationAccessSettings(): Promise<void>;
  configureNotificationCapture(
    tenantId: string,
    allowedPackages: string[],
    paused: boolean,
    generation: number,
  ): Promise<void>;
  prepareNotificationCaptureState(
    tenantId: string | null,
    cleanupTenantId: string | null,
    generation: number,
  ): Promise<void>;
  configureSmsCapture(
    tenantId: string,
    allowedSenders: string[],
    paused: boolean,
    generation: number,
  ): Promise<void>;
  pickSmsSender(): Promise<SmsSenderChoice | null>;
  syncSmsInbox(tenantId: string, generation: number): Promise<number>;
  deleteQueuedSms(tenantId: string, generation: number): Promise<void>;
  enqueueCapture(
    tenantId: string,
    envelopeId: string,
    sourceKind: "notification" | "sms",
    capturedAt: number,
    envelopeJson: string,
    generation: number,
  ): Promise<void>;
  getReadyCaptures(
    tenantId: string,
    now: number,
    generation: number,
  ): Promise<Array<{ envelopeId: string; attempts: number; envelopeJson: string }>>;
  getNotificationCapturePreviews(
    tenantId: string,
    now: number,
    generation: number,
  ): Promise<NotificationCapturePreview[]>;
  getSmsCapturePreviews(
    tenantId: string,
    now: number,
    generation: number,
  ): Promise<SmsCapturePreview[]>;
  setCapturePreviewSecure(enabled: boolean): Promise<void>;
  acknowledgeCapture(tenantId: string, envelopeId: string, generation: number): Promise<void>;
  failCapture(
    tenantId: string,
    envelopeId: string,
    terminal: boolean,
    generation: number,
  ): Promise<void>;
  clearCaptureQueue(tenantId: string, generation: number): Promise<void>;
  getRetainedCaptureContent(
    tenantId: string,
    envelopeIds: string[],
    generation: number,
  ): Promise<Record<string, string>>;
};

export default requireOptionalNativeModule<RelayDeviceIngressNativeModule>("RelayDeviceIngress");
