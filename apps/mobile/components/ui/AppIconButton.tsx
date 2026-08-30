import { IconButton } from "react-native-paper";

import { useRelayTheme } from "@/theme";

type AppIconButtonProps = {
  accessibilityHint?: string | undefined;
  accessibilityLabel: string;
  disabled?: boolean;
  icon: string;
  onPress: () => void;
  variant?: "default" | "back" | "danger";
};

export function AppIconButton({
  accessibilityHint,
  accessibilityLabel,
  disabled = false,
  icon,
  onPress,
  variant = "default",
}: AppIconButtonProps) {
  const theme = useRelayTheme();
  const danger = variant === "danger";
  return (
    <IconButton
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      {...(danger ? { containerColor: theme.relay.colors.dangerSurface } : {})}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      icon={icon}
      iconColor={danger ? theme.relay.colors.danger : theme.relay.colors.action}
      mode={variant === "back" ? "outlined" : "contained-tonal"}
      onPress={onPress}
      size={theme.relay.sizes.icon.md}
      style={{
        height: theme.relay.sizes.touchTarget,
        margin: 0,
        width: theme.relay.sizes.touchTarget,
      }}
    />
  );
}
