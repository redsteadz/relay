import type { Category, CategoryCreateRequest } from "@relay/contracts";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppButton, AppText, ConfirmationDialog, StatusMessage } from "@/components/ui";
import { CategoryCard } from "@/features/categories/components/CategoryCard";
import { CategoryEditorDialog } from "@/features/categories/components/CategoryEditorDialog";
import { useCategoryManagement } from "@/features/categories/hooks/useCategoryManagement";
import { categoryErrorMessage } from "@/features/categories/models/categoryPresentation";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

function reportCategoryUiFailure(error: unknown, operation: string): void {
  reportUnexpectedUiError(error, "ui.category_operation_failed", {
    code: "CATEGORY_UI_OPERATION_FAILED",
    integration: "supabase-postgrest",
    operation,
  });
}

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
    } catch (error: unknown) {
      // The fixed category error remains visible in the editor.
      reportCategoryUiFailure(error, "saveCategory");
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
    <Page
      action={
        <View style={[styles.headerActions, { gap: theme.relay.spacing.sm }]}>
          <AppButton label="Back" onPress={() => router.back()} tone="secondary" />
          <AppButton
            disabled={session === null}
            label="New category"
            onPress={() => {
              categories.clearError();
              setEditorCategory(null);
            }}
          />
        </View>
      }
      detail="Shape your own taxonomy without changing Relay's stable system vocabulary."
      eyebrow="Tenant-owned taxonomy"
      title="Categories"
    >
      {session === null ? (
        <StatusMessage tone="warning">Sign in to manage account categories.</StatusMessage>
      ) : null}
      {errorMessage === undefined || editorCategory !== undefined ? null : (
        <View style={{ gap: theme.relay.spacing.sm }}>
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
          <AppButton
            label={categories.loadError === null ? "Dismiss" : "Retry category loading"}
            onPress={() => {
              if (categories.loadError === null) categories.clearError();
              else void categories.refresh();
            }}
            tone="secondary"
          />
        </View>
      )}
      <Panel title="Custom categories" meta={`${categories.activeCustom.length.toString()} ACTIVE`}>
        <AppText tone="muted">
          Reorder affects presentation. Quiet changes emphasis only; it cannot dismiss a source
          notification without a separately approved rule.
        </AppText>
        <View style={{ gap: theme.relay.spacing.md }}>
          {categories.isLoading ? <AppText tone="muted">Loading categories...</AppText> : null}
          {!categories.isLoading && categories.activeCustom.length === 0 ? (
            <AppText tone="muted">
              No custom categories yet. Create one when the system set is not enough.
            </AppText>
          ) : null}
          {categories.activeCustom.map((category, index) => (
            <CategoryCard
              category={category}
              disableMoveDown={index === categories.activeCustom.length - 1}
              disableMoveUp={index === 0}
              disabled={categories.isMutating}
              key={category.id}
              onArchive={() =>
                void categories
                  .setArchived(category)
                  .catch((error: unknown) => reportCategoryUiFailure(error, "archiveCategory"))
              }
              onEdit={() => {
                categories.clearError();
                setEditorCategory(category);
              }}
              onMoveDown={() =>
                void categories
                  .move(category, 1)
                  .catch((error: unknown) => reportCategoryUiFailure(error, "moveCategoryDown"))
              }
              onMoveUp={() =>
                void categories
                  .move(category, -1)
                  .catch((error: unknown) => reportCategoryUiFailure(error, "moveCategoryUp"))
              }
              onQuietChange={(quiet) =>
                void categories
                  .setQuiet(category, quiet)
                  .catch((error: unknown) => reportCategoryUiFailure(error, "setCategoryQuiet"))
              }
            />
          ))}
        </View>
      </Panel>
      {categories.archivedCustom.length === 0 ? null : (
        <Panel
          title="Archived categories"
          meta={`${categories.archivedCustom.length.toString()} RETAINED`}
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
                onRestore={() =>
                  void categories
                    .restore(category)
                    .catch((error: unknown) => reportCategoryUiFailure(error, "restoreCategory"))
                }
              />
            ))}
          </View>
        </Panel>
      )}
      <Panel title="System categories" meta="STABLE">
        <AppText tone="muted">
          System slugs are protected machine identities. They remain visible but cannot be edited,
          archived, or deleted here.
        </AppText>
        <View style={{ gap: theme.relay.spacing.md }}>
          {categories.systemCategories.map((category) => (
            <CategoryCard category={category} disabled key={category.id} />
          ))}
        </View>
      </Panel>
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
        onConfirm={() =>
          void deleteSelectedCategory().catch((error: unknown) =>
            reportCategoryUiFailure(error, "deleteCategory"),
          )
        }
        title="Delete archived category?"
        visible={deleteTarget !== undefined}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", flexWrap: "wrap" },
});
