import "react-native-gesture-handler";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";

import { palette } from "@/components/Page";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { syncNotificationCaptures } from "@/lib/notification-capture-sync";

function AuthenticatedStack() {
  const { initialized, session } = useAuth();
  if (!initialized) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Restoring secure session...</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="auth/callback" />
      </Stack.Protected>
    </Stack>
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
      <NotificationCaptureSync />
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
  loadingText: { color: palette.muted, fontSize: 14 },
});
