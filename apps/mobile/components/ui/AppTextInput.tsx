import type { ComponentProps } from "react";
import { View } from "react-native";
import { HelperText, TextInput } from "react-native-paper";

import { useRelayTheme } from "@/theme";

type PaperTextInputProps = ComponentProps<typeof TextInput>;
type AppTextInputProps = Omit<PaperTextInputProps, "error" | "mode" | "style" | "theme"> & {
  errorMessage?: string | undefined;
};

export function AppTextInput({ errorMessage, ...props }: AppTextInputProps) {
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
        outlineColor={theme.relay.colors.borderSubtle}
        outlineStyle={{ borderRadius: theme.relay.radii.sm }}
        style={{
          backgroundColor: theme.relay.colors.surface,
          minHeight: theme.relay.sizes.control,
        }}
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
