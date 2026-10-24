import { Dialog, Portal } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

type ConfirmationDialogProps = {
  confirmLabel: string;
  /** Destructive by default; an affirmative decision such as an approval is not a deletion. */
  confirmTone?: "destructive" | "primary";
  detail: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  visible: boolean;
};

export function ConfirmationDialog({
  confirmLabel,
  confirmTone = "destructive",
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
        <Dialog.Icon
          color={
            confirmTone === "destructive" ? theme.relay.colors.danger : theme.relay.colors.accent
          }
          icon={confirmTone === "destructive" ? "alert-octagon-outline" : "send-check-outline"}
        />
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
            tone={confirmTone}
          />
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
