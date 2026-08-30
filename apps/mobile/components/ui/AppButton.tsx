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
  testID,
  tone = "primary",
}: AppButtonProps) {
  const theme = useRelayTheme();
  const state = getButtonState(tone, disabled, loading);
  const contained = tone === "primary" || tone === "destructive";
  const foreground = tone === "destructive" ? theme.relay.colors.danger : theme.relay.colors.action;
  const buttonColor =
    tone === "destructive" ? theme.relay.colors.danger : theme.relay.colors.action;
  const onButton =
    tone === "destructive" ? theme.relay.colors.onDanger : theme.relay.colors.onAction;

  return (
    <Button
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      {...(testID === undefined ? {} : { testID })}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={state.accessibilityState}
      {...(contained ? { buttonColor } : {})}
      contentStyle={{ minHeight: theme.relay.interaction.minimumTarget }}
      disabled={state.inactive}
      labelStyle={theme.relay.typography.label}
      loading={loading}
      mode={contained ? "contained" : "outlined"}
      onPress={onPress}
      style={[
        { borderColor: foreground, borderRadius: theme.relay.radii.sm },
        state.inactive && { opacity: theme.relay.interaction.disabledOpacity },
      ]}
      textColor={contained ? onButton : foreground}
    >
      {label}
    </Button>
  );
}
