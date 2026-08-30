import { View } from "react-native";
import { Dialog, Portal } from "react-native-paper";

import { AppButton, AppText, type ButtonTone } from "@/components/ui";
import { useRelayTheme } from "@/theme";

export type SourceSettingsAction = {
  disabled?: boolean;
  key: string;
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
};

type SourceSettingsDialogProps = {
  actions: SourceSettingsAction[];
  detail: string;
  onDismiss: () => void;
  sourceName: string;
  visible: boolean;
};

export function SourceSettingsDialog({
  actions,
  detail,
  onDismiss,
  sourceName,
  visible,
}: SourceSettingsDialogProps) {
  const theme = useRelayTheme();
  return (
    <Portal>
      <Dialog onDismiss={onDismiss} visible={visible}>
        <Dialog.Icon color={theme.relay.colors.action} icon="cog-outline" />
        <Dialog.Title style={[theme.relay.typography.heading, { textAlign: "center" }]}>
          {sourceName} settings
        </Dialog.Title>
        <Dialog.Content>
          <View style={{ gap: theme.relay.spacing.md }}>
            <AppText tone="muted">{detail}</AppText>
            {actions.map((action) => (
              <AppButton
                {...(action.disabled === undefined ? {} : { disabled: action.disabled })}
                key={action.key}
                label={action.label}
                onPress={action.onPress}
                tone={action.tone ?? "secondary"}
              />
            ))}
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <AppButton label="Close" onPress={onDismiss} tone="secondary" />
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
