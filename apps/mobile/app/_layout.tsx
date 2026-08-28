import "react-native-gesture-handler";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";

import { LoadingState } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { syncNotificationCaptures } from "@/lib/notification-capture-sync";
import { RelayThemeProvider, useRelayTheme } from "@/theme";

function AuthenticatedStack() {
  const { initialized, session } = useAuth();
  if (!initialized) {
    return <LoadingState label="Restoring secure session..." />;
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

function ThemedRoot() {
  const theme = useRelayTheme();
  return (
    <AuthProvider>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <NotificationCaptureSync />
      <AuthenticatedStack />
    </AuthProvider>
  );
}

export default function RootLayout() {
  return (
    <RelayThemeProvider>
      <ThemedRoot />
    </RelayThemeProvider>
  );
}
