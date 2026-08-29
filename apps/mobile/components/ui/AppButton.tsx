import type { StyleProp, ViewStyle } from "react-native";
import { Button } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { getButtonState, type ButtonTone } from "./component-state";

type AppButtonProps = {
  accessibilityHint?: string | undefined;
  accessibilityLabel?: string | undefined;
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle> | undefined;
  testID?: string | undefined;
  tone?: ButtonTone;
};

export function AppButton({
  accessibilityHint,
  accessibilityLabel,
  disabled = false,
  label,
  loading = false,
  onPress,
  style,
  testID,
  tone = "primary",
}: AppButtonProps) {
  const theme = useRelayTheme();
  const state = getButtonState(tone, disabled, loading);
  const isPrimary = tone === "primary";
  const foreground = tone === "destructive" ? theme.relay.colors.danger : theme.relay.colors.accent;

  return (
    <Button
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      {...(testID === undefined ? {} : { testID })}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={state.accessibilityState}
      buttonColor={isPrimary ? theme.relay.colors.accent : "transparent"}
      contentStyle={{ minHeight: theme.relay.interaction.minimumTarget }}
      disabled={state.inactive}
      labelStyle={theme.relay.typography.label}
      loading={loading}
      mode={isPrimary ? "contained" : "outlined"}
      onPress={onPress}
      style={[
        { borderColor: foreground, borderRadius: theme.relay.radii.md },
        state.inactive && { opacity: theme.relay.interaction.disabledOpacity },
        style,
      ]}
      textColor={isPrimary ? theme.relay.colors.onAccent : foreground}
    >
      {label}
    </Button>
  );
}
