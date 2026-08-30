import { Dialog, Portal } from "react-native-paper";

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
  return (
    <Portal>
      <Dialog dismissable={!loading} onDismiss={onCancel} visible={visible}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <AppText tone="muted">{detail}</AppText>
        </Dialog.Content>
        <Dialog.Actions>
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
