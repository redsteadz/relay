import { Dialog, Portal } from "react-native-paper";

import { AppButton, AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

type SourceDisclosureDialogProps = {
  disclosure: string;
  onDismiss: () => void;
  sourceName: string;
  visible: boolean;
};

export function SourceDisclosureDialog({
  disclosure,
  onDismiss,
  sourceName,
  visible,
}: SourceDisclosureDialogProps) {
  const theme = useRelayTheme();
  return (
    <Portal>
      <Dialog onDismiss={onDismiss} visible={visible}>
        <Dialog.Icon color={theme.relay.colors.info} icon="information-outline" />
        <Dialog.Title style={[theme.relay.typography.heading, { textAlign: "center" }]}>
          {sourceName} privacy
        </Dialog.Title>
        <Dialog.Content>
          <AppText>{disclosure}</AppText>
        </Dialog.Content>
        <Dialog.Actions>
          <AppButton label="Close" onPress={onDismiss} tone="secondary" />
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
