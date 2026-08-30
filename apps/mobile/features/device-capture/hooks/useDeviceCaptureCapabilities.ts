import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/lib/auth-context";
import {
  localDevelopmentAccessEnabled,
  localDiagnosticsDisabled,
  notificationCaptureMode,
} from "@/lib/development-access";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

type ScopedCapabilities = {
  capabilities: DeviceCapabilities;
  stateKey: string;
};

export function useDeviceCaptureMode() {
  const { session } = useAuth();
  const localDevelopmentAccess = localDevelopmentAccessEnabled(
    __DEV__,
    Constants.expoConfig?.extra?.relayBuildVariant,
    localDiagnosticsDisabled(),
  );
  return notificationCaptureMode(session?.user.id, localDevelopmentAccess, Platform.OS);
}

export function useDeviceCaptureCapabilities() {
  const mode = useDeviceCaptureMode();
  const requestRef = useRef(0);
  const [scopedCapabilities, setScopedCapabilities] = useState<ScopedCapabilities>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const capabilities =
    scopedCapabilities?.stateKey === mode.stateKey ? scopedCapabilities.capabilities : undefined;

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    setRefreshing(true);
    setError(undefined);
    try {
      const nextCapabilities = await RelayDeviceIngress.getCapabilities();
      if (request === requestRef.current) {
        setScopedCapabilities({ capabilities: nextCapabilities, stateKey: mode.stateKey });
      }
    } catch (error: unknown) {
      logMobileError("capture.capabilities_refresh_failed", error, {
        code: "CAPTURE_CAPABILITIES_REFRESH_FAILED",
        integration: "relay-device-ingress",
        operation: "getCapabilities",
      });
      if (request === requestRef.current) {
        setScopedCapabilities(undefined);
        setError("Could not read source permissions and capture settings.");
      }
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, [mode.stateKey]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        requestRef.current += 1;
        subscription.remove();
      };
    }, [refresh]),
  );

  return { capabilities, error, mode, refresh, refreshing };
}
