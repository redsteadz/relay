import { Dialog, Portal } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

type ConfirmationDialogProps = {
  confirmLabel: string;
  detail: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  visible: boolean;
};

export function ConfirmationDialog({
  confirmLabel,
  detail,
  loading = false,
  onCancel,
  onConfirm,
  title,
  visible,
}: ConfirmationDialogProps) {
  const theme = useRelayTheme();
  return (
    <Portal>
      <Dialog
        dismissable={!loading}
        onDismiss={onCancel}
        style={{ borderRadius: theme.relay.radii.lg }}
        visible={visible}
      >
        <Dialog.Icon color={theme.relay.colors.danger} icon="alert-octagon-outline" />
        <Dialog.Title style={[theme.relay.typography.heading, { textAlign: "center" }]}>
          {title}
        </Dialog.Title>
        <Dialog.Content>
          <AppText tone="muted">{detail}</AppText>
        </Dialog.Content>
        <Dialog.Actions style={{ gap: theme.relay.spacing.sm }}>
          <AppButton disabled={loading} label="Cancel" onPress={onCancel} tone="secondary" />
          <AppButton
            label={confirmLabel}
            loading={loading}
            onPress={onConfirm}
            tone="destructive"
          />
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
