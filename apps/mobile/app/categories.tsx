import type { Category, CategoryCreateRequest } from "@relay/contracts";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import {
  ActionRow,
  AppButton,
  AppText,
  ConfirmationDialog,
  EditorialSurface,
  FeedbackState,
  LoadingState,
  StatusMessage,
} from "@/components/ui";
import { CategoryCard } from "@/features/categories/components/CategoryCard";
import { CategoryEditorDialog } from "@/features/categories/components/CategoryEditorDialog";
import { useCategoryManagement } from "@/features/categories/hooks/useCategoryManagement";
import { categoryErrorMessage } from "@/features/categories/models/categoryPresentation";
import { useAuth } from "@/lib/auth-context";
import { useRelayTheme } from "@/theme";

export default function CategoriesScreen() {
  const theme = useRelayTheme();
  const { client, session } = useAuth();
  const categories = useCategoryManagement(client, session?.user.id);
  const [editorCategory, setEditorCategory] = useState<Category | null>();
  const [deleteTarget, setDeleteTarget] = useState<Category>();

  async function saveCategory(request: CategoryCreateRequest) {
    try {
      if (editorCategory === undefined) return;
      if (editorCategory === null) await categories.create(request);
      else await categories.save(editorCategory, request);
      setEditorCategory(undefined);
    } catch {
      // The fixed category error remains visible in the editor.
    }
  }

  async function deleteSelectedCategory() {
    if (deleteTarget === undefined) return;
    try {
      await categories.remove(deleteTarget);
    } finally {
      setDeleteTarget(undefined);
    }
  }

  const errorMessage =
    categories.error === null ? undefined : categoryErrorMessage(categories.error);
  const editorErrorMessage =
    categories.operationError === null
      ? undefined
      : categoryErrorMessage(categories.operationError);

  return (
    <AppScreen
      action={
        <AppButton
          disabled={session === null}
          label="New category"
          onPress={() => {
            categories.clearError();
            setEditorCategory(null);
          }}
        />
      }
      backLabel="Back to settings"
      detail="Shape your own taxonomy without changing Relay's stable system vocabulary."
      eyebrow="Tenant-owned taxonomy"
      onBack={() => router.back()}
      title="Categories"
    >
      {session === null ? (
        <StatusMessage tone="warning">Sign in to manage account categories.</StatusMessage>
      ) : null}
      {errorMessage === undefined || editorCategory !== undefined ? null : (
        <View style={{ gap: theme.relay.spacing.sm }}>
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
          <ActionRow>
            <AppButton
              label={categories.loadError === null ? "Dismiss" : "Retry category loading"}
              onPress={() => {
                if (categories.loadError === null) categories.clearError();
                else void categories.refresh();
              }}
              tone="secondary"
            />
          </ActionRow>
        </View>
      )}
      <EditorialSurface
        icon="shape-plus-outline"
        title="Custom categories"
        meta={`${categories.activeCustom.length.toString()} active`}
        variant="raised"
      >
        <AppText tone="muted">
          Reorder affects presentation. Quiet changes emphasis only; it cannot dismiss a source
          notification without a separately approved rule.
        </AppText>
        <View style={{ gap: theme.relay.spacing.md }}>
          {categories.isLoading ? <LoadingState label="Loading categories..." /> : null}
          {!categories.isLoading && categories.activeCustom.length === 0 ? (
            <FeedbackState
              detail="Create one when the protected system set is not enough."
              title="No custom categories yet"
            />
          ) : null}
          {categories.activeCustom.map((category, index) => (
            <CategoryCard
              category={category}
              disableMoveDown={index === categories.activeCustom.length - 1}
              disableMoveUp={index === 0}
              disabled={categories.isMutating}
              key={category.id}
              onArchive={() => void categories.setArchived(category).catch(() => undefined)}
              onEdit={() => {
                categories.clearError();
                setEditorCategory(category);
              }}
              onMoveDown={() => void categories.move(category, 1).catch(() => undefined)}
              onMoveUp={() => void categories.move(category, -1).catch(() => undefined)}
              onQuietChange={(quiet) =>
                void categories.setQuiet(category, quiet).catch(() => undefined)
              }
            />
          ))}
        </View>
      </EditorialSurface>
      {categories.archivedCustom.length === 0 ? null : (
        <EditorialSurface
          icon="archive-outline"
          title="Archived categories"
          meta={`${categories.archivedCustom.length.toString()} retained`}
        >
          <AppText tone="muted">
            Archived categories preserve historical classifications. Permanent deletion is only
            available when no history references the category.
          </AppText>
          <View style={{ gap: theme.relay.spacing.md }}>
            {categories.archivedCustom.map((category) => (
              <CategoryCard
                category={category}
                disabled={categories.isMutating}
                key={category.id}
                onDelete={() => setDeleteTarget(category)}
                onRestore={() => void categories.restore(category).catch(() => undefined)}
              />
            ))}
          </View>
        </EditorialSurface>
      )}
      <EditorialSurface icon="shield-check-outline" title="System categories" meta="Stable">
        <AppText tone="muted">
          System slugs are protected machine identities. They remain visible but cannot be edited,
          archived, or deleted here.
        </AppText>
        <View style={{ gap: theme.relay.spacing.md }}>
          {categories.systemCategories.map((category) => (
            <CategoryCard category={category} disabled key={category.id} />
          ))}
        </View>
      </EditorialSurface>
      <CategoryEditorDialog
        category={editorCategory ?? null}
        errorMessage={editorCategory === undefined ? undefined : editorErrorMessage}
        onDismiss={() => {
          if (!categories.isMutating) {
            categories.clearError();
            setEditorCategory(undefined);
          }
        }}
        onSave={saveCategory}
        saving={categories.isMutating}
        visible={editorCategory !== undefined}
      />
      <ConfirmationDialog
        confirmLabel="Delete permanently"
        detail={
          deleteTarget === undefined
            ? ""
            : `Delete ${deleteTarget.name}? If it explains historical classifications, Relay will refuse and keep it archived.`
        }
        loading={categories.isMutating}
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={() => void deleteSelectedCategory()}
        title="Delete archived category?"
        visible={deleteTarget !== undefined}
      />
    </AppScreen>
  );
}
