import { requireOptionalNativeModule } from "expo";

import type { NotificationSilenceMode } from "@relay/contracts";

export type NativeDeviceCapabilities = {
  notificationAllowedPackages: string[];
  notificationCapturePaused: boolean;
  notificationListener: boolean;
  notificationSilenceKillSwitch: boolean;
  notificationSilenceMode: NotificationSilenceMode;
  notificationSilenceRevision: number;
  notificationSilenceRuleCount: number;
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

/** One content-free verdict from the device's own silencing ledger. */
export type NativeSilenceOutcome = {
  applicationId: string;
  decidedAt: number;
  decision: string;
  envelopeId: string;
  filterRuleId?: string;
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
  openApplicationNotificationSettings(packageName: string): Promise<void>;
  configureNotificationSilence(
    tenantId: string,
    snapshotJson: string,
    revision: number,
    generation: number,
  ): Promise<void>;
  setNotificationSilenceKillSwitch(
    tenantId: string,
    engaged: boolean,
    generation: number,
  ): Promise<void>;
  getNotificationSilenceOutcomes(
    tenantId: string,
    limit: number,
    generation: number,
  ): Promise<NativeSilenceOutcome[]>;
  getNotificationSilenceCounts(
    tenantId: string,
    filterRuleId: string,
    since: number,
    generation: number,
  ): Promise<{ matched: number; observed: number }>;
};

export default requireOptionalNativeModule<RelayDeviceIngressNativeModule>("RelayDeviceIngress");
