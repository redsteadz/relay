import { zodResolver } from "@hookform/resolvers/zod";
import { accountDeletionRequestSchema } from "@relay/contracts";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Dialog, Portal } from "react-native-paper";

import { AppButton, AppText, AppTextInput, StatusMessage } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { privacyErrorMessage } from "../models/privacyPresentation";

type AccountDeletionDialogProps = {
  deleting: boolean;
  error: unknown;
  onDelete: () => Promise<void>;
  onDismiss: () => void;
  visible: boolean;
};

export function AccountDeletionDialog({
  deleting,
  error,
  onDelete,
  onDismiss,
  visible,
}: AccountDeletionDialogProps) {
  const theme = useRelayTheme();
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: { confirm: "" as "delete my account" },
    mode: "onChange",
    resolver: zodResolver(accountDeletionRequestSchema),
  });

  useEffect(() => {
    if (visible) reset({ confirm: "" as "delete my account" });
  }, [reset, visible]);

  return (
    <Portal>
      <Dialog dismissable={!deleting} onDismiss={onDismiss} visible={visible}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Dialog.Icon color={theme.relay.colors.danger} icon="delete-forever-outline" />
          <Dialog.Title style={[theme.relay.typography.heading, { textAlign: "center" }]}>
            Delete Relay account?
          </Dialog.Title>
          <Dialog.Content>
            <View style={{ gap: theme.relay.spacing.md }}>
              <AppText tone="danger" variant="bodyStrong">
                This is irreversible.
              </AppText>
              <AppText tone="muted">
                Relay will revoke connectors, cancel pending actions, invalidate devices, remove
                stored credentials, and delete tenant data. Managed backups age out on the provider
                schedule.
              </AppText>
              <Controller
                control={control}
                name="confirm"
                render={({ field: { onBlur, onChange, value } }) => (
                  <AppTextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    errorMessage={
                      errors.confirm === undefined
                        ? undefined
                        : "Type the exact phrase to continue."
                    }
                    label={'Type "delete my account"'}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                )}
              />
              {error === null ? null : (
                <StatusMessage tone="error">{privacyErrorMessage(error)}</StatusMessage>
              )}
            </View>
          </Dialog.Content>
          <Dialog.Actions style={{ gap: theme.relay.spacing.sm }}>
            <AppButton disabled={deleting} label="Cancel" onPress={onDismiss} tone="secondary" />
            <AppButton
              label="Delete account"
              loading={deleting}
              onPress={() => void handleSubmit(onDelete)().catch(() => undefined)}
              tone="destructive"
            />
          </Dialog.Actions>
        </KeyboardAvoidingView>
      </Dialog>
    </Portal>
  );
}
