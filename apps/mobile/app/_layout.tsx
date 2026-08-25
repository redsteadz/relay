import "react-native-gesture-handler";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

import { palette } from "@/components/Page";
import { AuthProvider, useAuth } from "@/lib/auth-context";

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
  loadingText: { color: palette.muted, fontSize: 14 },
});
