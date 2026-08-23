import { requireOptionalNativeModule } from "expo";

export type DeviceCapabilities = {
  notificationListener: boolean;
  smsRead: boolean;
  platform: string;
};

type RelayDeviceIngressNativeModule = {
  getCapabilities(): Promise<DeviceCapabilities>;
  openNotificationAccessSettings(): Promise<void>;
};

export default requireOptionalNativeModule<RelayDeviceIngressNativeModule>("RelayDeviceIngress");
