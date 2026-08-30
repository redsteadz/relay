import { Tabs } from "expo-router";
import { Icon } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useRelayTheme } from "@/theme";

const symbols: Record<string, string> = {
  index: "inbox-outline",
  automations: "tune-variant",
  connections: "connection",
  activity: "history",
  settings: "cog-outline",
};

export default function TabsLayout() {
  const theme = useRelayTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.relay.colors.accent,
        tabBarInactiveTintColor: theme.relay.colors.textMuted,
        tabBarLabelStyle: theme.relay.typography.caption,
        tabBarStyle: {
          backgroundColor: theme.relay.colors.surface,
          borderTopColor: theme.relay.colors.border,
          borderTopWidth: theme.relay.borders.emphasis,
          elevation: theme.relay.elevation.flat,
          height: theme.relay.sizes.navigationBar + insets.bottom,
          paddingBottom: Math.max(theme.relay.spacing.sm, insets.bottom),
          paddingTop: theme.relay.spacing.sm,
        },
        tabBarIcon: ({ focused }) => (
          <Icon
            color={focused ? theme.relay.colors.accent : theme.relay.colors.textMuted}
            size={theme.relay.sizes.icon.lg}
            source={symbols[route.name] ?? "circle-outline"}
          />
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
