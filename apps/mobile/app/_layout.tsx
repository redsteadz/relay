import "react-native-gesture-handler";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";

import { AppText, LoadingState } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import {
  canEnterApp,
  canEnterSignIn,
  localDevelopmentAccessEnabled,
  notificationCaptureMode,
} from "@/lib/development-access";
import { syncDeviceCaptures } from "@/lib/device-capture-sync";
import { logMobileError, runInBackground } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { RelayThemeProvider, useRelayTheme } from "@/theme";

function AuthenticatedStack() {
  const { initialized, session } = useAuth();
  const queryClient = useQueryClient();
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
  const previousUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const userId = session?.user.id;
    if (previousUserIdRef.current !== userId) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] === "categories" || query.queryKey[0] === "privacy",
      });
      previousUserIdRef.current = userId;
    }
  }, [queryClient, session?.user.id]);

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
    })().catch((error: unknown) => {
      logMobileError("background.capture_state_preparation_failed", error, {
        code: "CAPTURE_STATE_PREPARATION_FAILED",
        integration: "relay-device-ingress",
        operation: "prepareNotificationCaptureState",
      });
      if (active) setPreparationFailed(true);
    });
    return () => {
      active = false;
    };
  }, [captureMode.cleanupTenantId, captureMode.stateKey, captureMode.tenantId, initialized]);

  if (!initialized || preparedStateKey !== captureMode.stateKey) {
    if (!preparationFailed) {
      return (
        <LoadingState
          label={initialized ? "Preparing secure device capture..." : "Restoring secure session..."}
        />
      );
    }
    return (
      <View style={styles.loading}>
        <AppText style={styles.loadingError} tone="danger">
          Could not prepare secure device capture. Restart Relay to retry.
        </AppText>
      </View>
    );
  }

  const appAccessAllowed = canEnterApp(session !== null, localDevelopmentAccess);

  return (
    <>
      <DeviceCaptureSync />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={appAccessAllowed}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="categories" />
          <Stack.Screen name="disclosures" />
        </Stack.Protected>
        <Stack.Protected guard={canEnterSignIn(session !== null)}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={session === null}>
          <Stack.Screen name="auth/callback" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function DeviceCaptureSync() {
  const { session } = useAuth();

  useEffect(() => {
    if (session === null) return;
    const sync = () =>
      runInBackground(syncDeviceCaptures(session), "background.device_capture_sync_failed", {
        code: "DEVICE_CAPTURE_SYNC_FAILED",
        integration: "relay-device-ingress",
        operation: "syncDeviceCaptures",
      });
    sync();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => subscription.remove();
  }, [session]);

  return null;
}

function ThemedRoot() {
  const theme = useRelayTheme();
  return (
    <AuthProvider>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <AuthenticatedStack />
    </AuthProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000 },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <RelayThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ThemedRoot />
      </QueryClientProvider>
    </RelayThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  loadingError: { maxWidth: 320, textAlign: "center" },
});
