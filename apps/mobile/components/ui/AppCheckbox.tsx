import { StyleSheet, View } from "react-native";
import { Checkbox, TouchableRipple } from "react-native-paper";

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
    <TouchableRipple
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      borderless={false}
      onPress={() => onChange(!checked)}
      style={{
        borderRadius: theme.relay.radii.sm,
        minHeight: theme.relay.interaction.minimumTarget,
      }}
    >
      <View style={[styles.row, { gap: theme.relay.spacing.sm }]}>
        <View importantForAccessibility="no-hide-descendants" pointerEvents="none">
          <Checkbox status={checked ? "checked" : "unchecked"} />
        </View>
        <AppText style={styles.label} tone="muted">
          {label}
        </AppText>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  label: { flex: 1 },
  row: { alignItems: "center", flexDirection: "row" },
});
