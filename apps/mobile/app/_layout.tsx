import "react-native-gesture-handler";

import Constants from "expo-constants";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";

import { palette } from "@/components/Page";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import {
  canEnterApp,
  localDevelopmentAccessEnabled,
  notificationCaptureMode,
} from "@/lib/development-access";
import { syncNotificationCaptures } from "@/lib/notification-capture-sync";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

function AuthenticatedStack() {
  const { initialized, session } = useAuth();
  const localDevelopmentAccess = localDevelopmentAccessEnabled(
    __DEV__,
    Constants.expoConfig?.extra?.relayBuildVariant,
  );
  const captureMode = notificationCaptureMode(
    session?.user.id,
    localDevelopmentAccess,
    Platform.OS,
  );
  const [preparedStateKey, setPreparedStateKey] = useState<string>();
  const [preparationFailed, setPreparationFailed] = useState(false);
  const preparationGenerationRef = useRef(0);

  useEffect(() => {
    if (!initialized) return;
    let active = true;
    const generation = Math.max(Date.now(), preparationGenerationRef.current + 1);
    preparationGenerationRef.current = generation;
    setPreparedStateKey(undefined);
    setPreparationFailed(false);
    void (async () => {
      await RelayDeviceIngress.prepareNotificationCaptureState(
        captureMode.tenantId,
        captureMode.cleanupTenantId,
        generation,
      );
      if (active) setPreparedStateKey(captureMode.stateKey);
    })().catch(() => {
      if (active) setPreparationFailed(true);
    });
    return () => {
      active = false;
    };
  }, [captureMode.cleanupTenantId, captureMode.stateKey, captureMode.tenantId, initialized]);

  if (!initialized || preparedStateKey !== captureMode.stateKey) {
    return (
      <View style={styles.loading}>
        <Text style={preparationFailed ? styles.loadingError : styles.loadingText}>
          {preparationFailed
            ? "Could not prepare secure notification capture. Restart Relay to retry."
            : initialized
              ? "Preparing secure notification capture..."
              : "Restoring secure session..."}
        </Text>
      </View>
    );
  }

  const appAccessAllowed = canEnterApp(session !== null, localDevelopmentAccess);

  return (
    <>
      <NotificationCaptureSync />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={appAccessAllowed}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!appAccessAllowed}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={session === null}>
          <Stack.Screen name="auth/callback" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function NotificationCaptureSync() {
  const { session } = useAuth();

  useEffect(() => {
    if (session === null) return;
    const sync = () => void syncNotificationCaptures(session).catch(() => undefined);
    sync();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => subscription.remove();
  }, [session]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <AuthenticatedStack />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    backgroundColor: palette.background,
    flex: 1,
    justifyContent: "center",
  },
  loadingError: { color: palette.amber, fontSize: 14, maxWidth: 320, textAlign: "center" },
  loadingText: { color: palette.muted, fontSize: 14 },
});
