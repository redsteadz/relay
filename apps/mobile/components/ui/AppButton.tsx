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
  // The primary control carries the accent rather than the near-white `action` neutral. A white
  // slab was the loudest thing on a dark screen whatever it said, so "New" outshouted the rules it
  // sat above; the accent is the one colour Relay has already reserved for what it wants looked at.
  // A destructive control is tonal rather than filled with the danger colour itself. "Remove from
  // inbox" rendered as a solid pink slab was the largest and brightest element on the receipt, which
  // made the one irreversible control on the screen also the most inviting one. The tonal surface
  // keeps it unmistakably red and stops it competing for the first glance.
  const foreground = tone === "destructive" ? theme.relay.colors.danger : theme.relay.colors.text;
  const buttonColor =
    tone === "destructive" ? theme.relay.colors.dangerSurface : theme.relay.colors.accent;
  const onButton =
    tone === "destructive" ? theme.relay.colors.onDangerSurface : theme.relay.colors.onAccent;

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
        {
          borderColor: tone === "destructive" ? foreground : theme.relay.colors.borderSubtle,
          borderRadius: theme.relay.radii.pill,
        },
        state.inactive && { opacity: theme.relay.interaction.disabledOpacity },
      ]}
      textColor={contained ? onButton : foreground}
    >
      {label}
    </Button>
  );
}
