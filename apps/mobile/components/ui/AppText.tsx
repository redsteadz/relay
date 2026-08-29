import type { ComponentProps } from "react";
import { Text as PaperText } from "react-native-paper";

import { useRelayTheme } from "@/theme";
import type { RelaySemanticTokens } from "@/theme";

type TextTone = "default" | "muted" | "accent" | "danger" | "warning" | "success";
type TextVariant = keyof RelaySemanticTokens["typography"];
type PaperTextProps = ComponentProps<typeof PaperText>;

type AppTextProps = Omit<PaperTextProps, "variant"> & {
  tone?: TextTone;
  variant?: TextVariant;
};

export function AppText({ style, tone = "default", variant = "body", ...props }: AppTextProps) {
  const theme = useRelayTheme();
  const colors = theme.relay.colors;
  const color = {
    default: colors.text,
    muted: colors.textMuted,
    accent: colors.accent,
    danger: colors.danger,
    warning: colors.warning,
    success: colors.success,
  }[tone];

  return <PaperText {...props} style={[theme.relay.typography[variant], { color }, style]} />;
}
