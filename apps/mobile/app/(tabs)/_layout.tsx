import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RelayIcon, type RelayIconName } from "@/components/ui";
import { useRelayTheme } from "@/theme";

/**
 * The five places a person can be.
 *
 * Relay's own icon set rather than the Material family, because the tab bar is the most-seen surface
 * in the app and the tray, the rule graph and the mark all belong to one hand. Selection is stated
 * with the accent alone: a filled variant of each glyph would double the vocabulary for no extra
 * information.
 */
const symbols: Record<string, RelayIconName> = {
  activity: "activity",
  automations: "rules",
  connections: "sources",
  index: "inbox",
  settings: "settings",
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
          <RelayIcon
            color={focused ? theme.relay.colors.accent : theme.relay.colors.textMuted}
            name={symbols[route.name] ?? "inbox"}
            size={theme.relay.sizes.icon.lg}
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
