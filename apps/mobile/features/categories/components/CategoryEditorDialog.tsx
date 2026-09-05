import { zodResolver } from "@hookform/resolvers/zod";
import {
  categoryCreateRequestSchema,
  type Category,
  type CategoryCreateRequest,
} from "@relay/contracts";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { View } from "react-native";

import {
  AppButton,
  AppDialog,
  AppSwitch,
  AppText,
  AppTextInput,
  StatusMessage,
} from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { categoryEditorDefaults } from "../models/categoryPresentation";

type CategoryEditorDialogProps = {
  category: Category | null;
  errorMessage?: string | undefined;
  onDismiss: () => void;
  onSave: (request: CategoryCreateRequest) => Promise<void>;
  saving: boolean;
  visible: boolean;
};

export function CategoryEditorDialog({
  category,
  errorMessage,
  onDismiss,
  onSave,
  saving,
  visible,
}: CategoryEditorDialogProps) {
  const theme = useRelayTheme();
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CategoryCreateRequest>({
    defaultValues: categoryEditorDefaults(category),
    mode: "onBlur",
    resolver: zodResolver(categoryCreateRequestSchema),
  });

  useEffect(() => {
    if (visible) reset(categoryEditorDefaults(category));
  }, [category, reset, visible]);

  const submit = handleSubmit(async (request) => onSave(request));

  return (
    <AppDialog
      actions={
        <>
          <AppButton disabled={saving} label="Cancel" onPress={onDismiss} tone="secondary" />
          <AppButton
            label={category === null ? "Create" : "Save"}
            loading={saving}
            onPress={() => void submit()}
          />
        </>
      }
      dismissable={!saving}
      icon={category === null ? "shape-plus-outline" : "pencil-outline"}
      onDismiss={onDismiss}
      title={category === null ? "Create category" : "Edit category"}
      visible={visible}
    >
      <View style={{ gap: theme.relay.spacing.md }}>
        <AppText tone="muted">
          Names are unique after case and extra spacing are normalized. Quiet categories do not
          dismiss source notifications.
        </AppText>
        <Controller
          control={control}
          name="name"
          render={({ field: { onBlur, onChange, value } }) => (
            <AppTextInput
              autoCapitalize="words"
              errorMessage={
                errors.name === undefined ? undefined : "Enter a name between 1 and 60 characters."
              }
              label="Name"
              maxLength={60}
              onBlur={onBlur}
              onChangeText={onChange}
              returnKeyType="next"
              value={value}
            />
          )}
        />
        <Controller
          control={control}
          name="slug"
          render={({ field: { onBlur, onChange, value } }) => (
            <AppTextInput
              autoCapitalize="none"
              autoCorrect={false}
              disabled={category !== null}
              errorMessage={
                errors.slug === undefined
                  ? undefined
                  : "Use 1–64 lowercase letters, numbers, or single hyphens."
              }
              label="Stable slug"
              maxLength={64}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="work-notes"
              value={value}
            />
          )}
        />
        <Controller
          control={control}
          name="description"
          render={({ field: { onBlur, onChange, value } }) => (
            <AppTextInput
              errorMessage={
                errors.description === undefined
                  ? undefined
                  : "Keep the description to 280 characters or fewer."
              }
              label="Description (optional)"
              maxLength={280}
              multiline
              onBlur={onBlur}
              onChangeText={onChange}
              value={value ?? ""}
            />
          )}
        />
        <Controller
          control={control}
          name="quietByDefault"
          render={({ field: { onChange, value } }) => (
            <AppSwitch
              detail="Reduces emphasis only. It never authorizes notification dismissal."
              label="Quiet by default"
              onValueChange={onChange}
              value={value ?? false}
            />
          )}
        />
        {errorMessage === undefined ? null : (
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
        )}
      </View>
    </AppDialog>
  );
}
