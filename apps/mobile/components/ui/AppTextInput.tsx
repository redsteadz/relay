import type { ComponentProps } from "react";
import { View } from "react-native";
import { HelperText, TextInput } from "react-native-paper";

import { useRelayTheme } from "@/theme";

type PaperTextInputProps = ComponentProps<typeof TextInput>;
type AppTextInputProps = Omit<PaperTextInputProps, "error" | "mode" | "theme"> & {
  errorMessage?: string | undefined;
};

export function AppTextInput({ errorMessage, style, ...props }: AppTextInputProps) {
  const theme = useRelayTheme();
  const hasError = errorMessage !== undefined && errorMessage.length > 0;

  return (
    <View>
      <TextInput
        {...props}
        activeOutlineColor={hasError ? theme.relay.colors.danger : theme.relay.colors.focus}
        contentStyle={theme.relay.typography.body}
        error={hasError}
        mode="outlined"
        outlineColor={theme.relay.colors.border}
        outlineStyle={{ borderRadius: theme.relay.radii.md }}
        style={[{ backgroundColor: theme.relay.colors.surfaceRaised }, style]}
        textColor={theme.relay.colors.text}
      />
      {hasError ? (
        <HelperText accessibilityLiveRegion="polite" type="error" visible>
          {errorMessage}
        </HelperText>
      ) : null}
    </View>
  );
}
