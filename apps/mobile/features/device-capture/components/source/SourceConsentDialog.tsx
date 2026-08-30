import { useEffect, useReducer, useRef } from "react";
import { View } from "react-native";
import { Dialog, Portal } from "react-native-paper";

import { ActionRow, AppButton, AppCheckbox, AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  consentReducer,
  consentSubmitEnabled,
  initialConsentState,
} from "../../models/consentFlow";

type SourceConsentDialogProps = {
  actionLabel: string;
  disclosure: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  sourceName: string;
  visible: boolean;
};

export function SourceConsentDialog({
  actionLabel,
  disclosure,
  loading = false,
  onCancel,
  onConfirm,
  sourceName,
  visible,
}: SourceConsentDialogProps) {
  const theme = useRelayTheme();
  const [consent, dispatch] = useReducer(consentReducer, initialConsentState);
  const wasVisible = useRef(false);

  useEffect(() => {
    if (wasVisible.current && !visible) dispatch({ type: "reset" });
    wasVisible.current = visible;
  }, [visible]);

  return (
    <Portal>
      <Dialog
        dismissable={!loading}
        onDismiss={onCancel}
        style={{ borderRadius: theme.relay.radii.lg }}
        visible={visible}
      >
        <Dialog.Icon color={theme.relay.colors.warning} icon="shield-alert-outline" />
        <Dialog.Title style={[theme.relay.typography.heading, { textAlign: "center" }]}>
          Authorize {sourceName}
        </Dialog.Title>
        <Dialog.Content>
          <View style={{ gap: theme.relay.spacing.lg }}>
            <AppText>{disclosure}</AppText>
            <AppCheckbox
              checked={consent.checked}
              label={`I understand what ${sourceName} reads, uploads, retains, and excludes.`}
              onChange={(checked) => dispatch({ checked, type: "set" })}
            />
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <ActionRow>
            <AppButton disabled={loading} label="Cancel" onPress={onCancel} tone="secondary" />
            <AppButton
              disabled={!consentSubmitEnabled(consent, loading)}
              label={actionLabel}
              loading={loading}
              onPress={onConfirm}
            />
          </ActionRow>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
