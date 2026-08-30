import { IconButton } from "react-native-paper";

import { useRelayTheme } from "@/theme";

type AppIconButtonProps = {
  accessibilityHint?: string | undefined;
  accessibilityLabel: string;
  compact?: boolean;
  disabled?: boolean;
  icon: string;
  onPress: () => void;
  variant?: "default" | "back" | "danger";
};

export function AppIconButton({
  accessibilityHint,
  accessibilityLabel,
  compact = false,
  disabled = false,
  icon,
  onPress,
  variant = "default",
}: AppIconButtonProps) {
  const theme = useRelayTheme();
  const danger = variant === "danger";
  const touchSize = compact ? theme.relay.sizes.compactTouchTarget : theme.relay.sizes.touchTarget;
  return (
    <IconButton
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      {...(danger ? { containerColor: theme.relay.colors.dangerSurface } : {})}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={compact ? theme.relay.spacing.xs : undefined}
      icon={icon}
      iconColor={danger ? theme.relay.colors.danger : theme.relay.colors.action}
      mode={variant === "back" ? "outlined" : "contained-tonal"}
      onPress={onPress}
      size={theme.relay.sizes.icon.md}
      style={{
        height: touchSize,
        margin: 0,
        width: touchSize,
      }}
    />
  );
}
