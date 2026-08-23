import { Tabs } from "expo-router";
import { Text } from "react-native";

const symbols: Record<string, string> = {
  index: "IN",
  automations: "AU",
  connections: "CO",
  activity: "AC",
  settings: "SE",
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#b9f6cf",
        tabBarInactiveTintColor: "#76837a",
        tabBarStyle: {
          backgroundColor: "#0d120f",
          borderTopColor: "#26332a",
          height: 66,
          paddingBottom: 8,
          paddingTop: 7,
        },
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>
            {symbols[route.name] ?? "--"}
          </Text>
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
