import { Stack } from "expo-router";

import { CapturePreviewSecurityProvider } from "@/features/device-capture/context/CapturePreviewSecurity";

export default function SourcesLayout() {
  return (
    <CapturePreviewSecurityProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="gmail" />
        <Stack.Screen name="notifications/index" />
        <Stack.Screen name="notifications/apps" options={{ presentation: "modal" }} />
        <Stack.Screen name="notifications/queue/index" />
        <Stack.Screen name="notifications/queue/[id]" />
        <Stack.Screen name="sms/index" />
        <Stack.Screen name="sms/contacts" options={{ presentation: "modal" }} />
        <Stack.Screen name="sms/queue/index" />
        <Stack.Screen name="sms/queue/[id]" />
      </Stack>
    </CapturePreviewSecurityProvider>
  );
}
