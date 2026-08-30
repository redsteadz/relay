import { StyleSheet, View } from "react-native";
import { Switch, TouchableRipple } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

type AppSwitchProps = {
  accessibilityHint?: string | undefined;
  detail?: string | undefined;
  disabled?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
};

export function AppSwitch({
  accessibilityHint,
  detail,
  disabled = false,
  label,
  onValueChange,
  value,
}: AppSwitchProps) {
  const theme = useRelayTheme();

  return (
    <TouchableRipple
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      borderless={false}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={{
        borderRadius: theme.relay.radii.sm,
        minHeight: theme.relay.interaction.minimumTarget,
        opacity: disabled ? theme.relay.interaction.disabledOpacity : 1,
      }}
    >
      <View style={[styles.row, { gap: theme.relay.spacing.md }]}>
        <View style={[styles.copy, { gap: theme.relay.spacing.xxs }]}>
          <AppText variant="label">{label}</AppText>
          {detail === undefined ? null : <AppText tone="muted">{detail}</AppText>}
        </View>
        <View
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[
            styles.switchTarget,
            {
              minHeight: theme.relay.sizes.touchTarget,
              minWidth: theme.relay.sizes.touchTarget,
            },
          ]}
        >
          <Switch value={value} />
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  row: { alignItems: "center", flexDirection: "row" },
  switchTarget: { alignItems: "center", justifyContent: "center" },
});
