import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RelayIcon, type RelayIconName } from "@/components/ui";
import { useRelayTheme } from "@/theme";

/**
 * The five places a person can be.
 *
 * Relay's own icon set rather than the Material family, because the tab bar is the most-seen surface
 * in the app and the tray, the rule graph and the mark all belong to one hand.
 *
 * Selection is now stated with a filled pill behind the glyph as well as with the accent. Colour
 * alone was legible in isolation and not in use: at a glance down a dark bar, one orange line
 * drawing among five grey ones is a weaker signal than one lit shape, and it was the only thing
 * saying which of five screens a person was on.
 */
const symbols: Record<string, RelayIconName> = {
  automations: "rules",
  connections: "sources",
  inbox: "inbox",
  index: "activity",
  settings: "settings",
};

export default function TabsLayout() {
  const theme = useRelayTheme();
  const { colors, radii, sizes, spacing, typography } = theme.relay;
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: typography.caption,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: theme.relay.borders.hairline,
          elevation: theme.relay.elevation.flat,
          height: sizes.navigationBar + insets.bottom,
          paddingBottom: Math.max(spacing.sm, insets.bottom),
          paddingTop: spacing.sm,
        },
        tabBarIcon: ({ focused }) => (
          <View
            style={[
              styles.indicator,
              {
                backgroundColor: focused ? colors.accentSubtle : "transparent",
                borderRadius: radii.pill,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.xxs,
              },
            ]}
          >
            <RelayIcon
              color={focused ? colors.accent : colors.textMuted}
              name={symbols[route.name] ?? "inbox"}
              size={sizes.icon.lg}
            />
          </View>
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
      <Tabs.Screen name="automations" options={{ title: "Rules" }} />
      <Tabs.Screen name="connections" options={{ title: "Sources" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  indicator: { alignItems: "center", justifyContent: "center" },
});
