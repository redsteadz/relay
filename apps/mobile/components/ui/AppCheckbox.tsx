import { Pressable, StyleSheet, View } from "react-native";
import { Checkbox } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

type AppCheckboxProps = {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

export function AppCheckbox({ checked, label, onChange }: AppCheckboxProps) {
  const theme = useRelayTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        borderRadius: theme.relay.radii.sm,
        minHeight: theme.relay.interaction.minimumTarget,
        opacity: pressed ? theme.relay.interaction.pressedOpacity : 1,
      })}
    >
      <View style={[styles.row, { gap: theme.relay.spacing.sm }]}>
        <View importantForAccessibility="no-hide-descendants" pointerEvents="none">
          <Checkbox status={checked ? "checked" : "unchecked"} />
        </View>
        <AppText style={styles.label} tone="muted">
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { flex: 1 },
  row: { alignItems: "center", flexDirection: "row" },
});
