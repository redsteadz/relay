import { View } from "react-native";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";
import { getMessageState, type MessageTone } from "./component-state";

type StatusMessageProps = {
  children: string;
  tone?: MessageTone;
};

export function StatusMessage({ children, tone = "info" }: StatusMessageProps) {
  const theme = useRelayTheme();
  const state = getMessageState(tone);
  const colors = theme.relay.colors;
  const toneColors = {
    info: [colors.infoSurface, colors.onInfoSurface],
    success: [colors.successSurface, colors.onSuccessSurface],
    warning: [colors.warningSurface, colors.onWarningSurface],
    error: [colors.dangerSurface, colors.onDangerSurface],
  } as const;
  const [backgroundColor, color] = toneColors[tone];

  return (
    <View
      accessibilityLiveRegion={state.liveRegion}
      accessibilityRole={state.accessibilityRole}
      style={{
        backgroundColor,
        borderRadius: theme.relay.radii.sm,
        paddingHorizontal: theme.relay.spacing.md,
        paddingVertical: theme.relay.spacing.sm,
      }}
    >
      <AppText style={{ color }}>{children}</AppText>
    </View>
  );
}
