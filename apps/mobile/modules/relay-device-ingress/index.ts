import { Platform } from "react-native";

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
};

export default RelayDeviceIngress;
