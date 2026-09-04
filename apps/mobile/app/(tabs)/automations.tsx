import type { FilterRuleVersion } from "@relay/contracts";
import { router } from "expo-router";
import { useState } from "react";

import { AppScreen } from "@/components/AppScreen";
import {
  AppButton,
  AppText,
  ConfirmationDialog,
  ContextualNotice,
  EditorialSurface,
  EmptyState,
  LoadingState,
  StatusMessage,
} from "@/components/ui";
import { useCategoryManagement } from "@/features/categories/hooks/useCategoryManagement";
import { FilterEditorDialog } from "@/features/filters/components/FilterEditorDialog";
import { FilterRuleCard } from "@/features/filters/components/FilterRuleCard";
import { useFilterRules } from "@/features/filters/hooks/useFilterRules";
import {
  filterDraftFor,
  filterSaveErrorMessage,
  filterSaveRequest,
  type FilterDraft,
} from "@/features/filters/models/filterPresentation";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";

function reportRuleUiFailure(error: unknown, operation: string): void {
  reportUnexpectedUiError(error, "ui.filter_rule_operation_failed", {
    code: "FILTER_RULE_UI_OPERATION_FAILED",
    integration: "relay-api",
    operation,
  });
}

export default function AutomationsScreen() {
  const { client, session } = useAuth();
  const filters = useFilterRules(client, session?.user.id, session?.access_token);
  const categories = useCategoryManagement(client, session?.user.id);
  const [editorDraft, setEditorDraft] = useState<FilterDraft>();
  const [disableTarget, setDisableTarget] = useState<FilterRuleVersion>();
  const signedIn = session !== null;

  const categoryDescriptors = categories.activeCustom
    .concat(categories.systemCategories)
    .map((category) => ({ name: category.name, slug: category.slug }));

  async function save(draft: FilterDraft) {
    try {
      await filters.save(filterSaveRequest(draft));
      setEditorDraft(undefined);
    } catch (error: unknown) {
      // The fixed save message stays visible in the editor; this only keeps the rejection observable.
      reportRuleUiFailure(error, "saveFilterRule");
    }
  }

  async function applyDisable() {
    if (disableTarget === undefined) return;
    try {
      await filters.save(
        filterSaveRequest({ ...filterDraftFor(disableTarget), enabled: !disableTarget.enabled }),
      );
    } catch (error: unknown) {
      reportRuleUiFailure(error, "toggleFilterRule");
    } finally {
      setDisableTarget(undefined);
    }
  }

  if (!signedIn) {
    return (
      <AppScreen
        detail="Plain language becomes inspectable predicates. Ambiguity is recorded, never hidden."
        eyebrow="Versioned filters"
        title="Rules"
      >
        <EditorialSurface icon="tune-variant" meta="Sign-in required" title="Rules">
          <AppText tone="muted">
            Rules are account-owned and versioned. Sign in to create and inspect them.
          </AppText>
          <AppButton
            label="Sign in to manage rules"
            onPress={() => router.push({ params: { reason: "rules" }, pathname: "/sign-in" })}
            tone="secondary"
          />
        </EditorialSurface>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      action={
        <AppButton
          disabled={filters.saving}
          label="New rule"
          onPress={() => {
            filters.clearSaveError();
            setEditorDraft(filterDraftFor(undefined));
          }}
        />
      }
      detail="Plain language becomes inspectable predicates. Ambiguity is recorded, never hidden."
      eyebrow="Versioned filters"
      title="Rules"
      titleAccessory={
        <ContextualNotice accessibilityLabel="How rules are evaluated">
          Deterministic checks always run first. A rule reaches a model only for a clause they
          cannot decide, and only if you have configured a key.
        </ContextualNotice>
      }
    >
      {filters.loadError === null || filters.loadError === undefined ? null : (
        <>
          <StatusMessage tone="error">
            Relay could not load your rules. Check your connection and retry.
          </StatusMessage>
          <AppButton
            label="Retry"
            onPress={() =>
              void filters.refresh().catch((error: unknown) => {
                reportRuleUiFailure(error, "refreshFilterRules");
              })
            }
            tone="secondary"
          />
        </>
      )}

      {filters.isLoading ? <LoadingState label="Loading rules" /> : null}

      {!filters.isLoading && filters.rules.length === 0 ? (
        <EmptyState
          detail="Describe a rule in plain language. Relay shows the compiled predicates, the semantic clause, and what it would disclose before you save."
          title="No rules yet"
        />
      ) : null}

      {filters.rules.map((rule) => (
        <FilterRuleCard
          disabled={filters.saving}
          history={filters.historyFor(rule.seriesId)}
          key={rule.seriesId}
          onEdit={() => {
            filters.clearSaveError();
            setEditorDraft(filterDraftFor(rule));
          }}
          onToggleEnabled={() => setDisableTarget(rule)}
          revision={rule}
        />
      ))}

      <FilterEditorDialog
        categories={categoryDescriptors}
        defaults={editorDraft ?? filterDraftFor(undefined)}
        errorMessage={
          filters.saveError === null || filters.saveError === undefined
            ? undefined
            : filterSaveErrorMessage(filters.saveError)
        }
        onDismiss={() => setEditorDraft(undefined)}
        onSave={save}
        saving={filters.saving}
        visible={editorDraft !== undefined}
      />

      <ConfirmationDialog
        confirmLabel={disableTarget?.enabled === true ? "Disable rule" : "Enable rule"}
        detail={
          disableTarget?.enabled === true
            ? "A disabled rule stops deciding anything from now on. Its versions and past decisions are kept, and you can enable it again."
            : "This rule starts deciding again from now on. It does not reprocess anything already handled."
        }
        loading={filters.saving}
        onCancel={() => setDisableTarget(undefined)}
        onConfirm={() => void applyDisable()}
        title={disableTarget?.enabled === true ? "Disable this rule?" : "Enable this rule?"}
        visible={disableTarget !== undefined}
      />
    </AppScreen>
  );
}
