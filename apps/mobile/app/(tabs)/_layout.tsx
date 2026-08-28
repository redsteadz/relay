import { Tabs } from "expo-router";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

const symbols: Record<string, string> = {
  index: "IN",
  automations: "AU",
  connections: "CO",
  activity: "AC",
  settings: "SE",
};

export default function TabsLayout() {
  const theme = useRelayTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.relay.colors.accent,
        tabBarInactiveTintColor: theme.relay.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.relay.colors.surface,
          borderTopColor: theme.relay.colors.border,
          height: 68,
          paddingBottom: theme.relay.spacing.sm,
          paddingTop: theme.relay.spacing.sm,
        },
        tabBarIcon: ({ color }) => (
          <AppText style={{ color }} variant="eyebrow">
            {symbols[route.name] ?? "--"}
          </AppText>
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Inbox" }} />
      <Tabs.Screen name="automations" options={{ title: "Rules" }} />
      <Tabs.Screen name="connections" options={{ title: "Sources" }} />
      <Tabs.Screen name="activity" options={{ title: "Activity" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
