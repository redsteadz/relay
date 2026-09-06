import type { FilterRuleVersion } from "@relay/contracts";
import { router } from "expo-router";
import { useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
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
import { RuleRow } from "@/features/filters/components/RuleRow";
import { useFilterRules } from "@/features/filters/hooks/useFilterRules";
import { filterDraftFor, filterSaveRequest } from "@/features/filters/models/filterPresentation";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";

function reportRuleUiFailure(error: unknown, operation: string): void {
  reportUnexpectedUiError(error, "ui.filter_rule_operation_failed", {
    code: "FILTER_RULE_UI_OPERATION_FAILED",
    integration: "relay-api",
    operation,
  });
}

/**
 * The rules deciding what happens to a capture.
 *
 * A rule is a series rather than a setting, so the list shows which revision is running and how many
 * earlier ones are kept. Editing opens a screen, because a change appends a version and the plan it
 * compiles to deserves to be read before it is saved. Only the pause switch acts in place.
 */
export default function AutomationsScreen() {
  const { client, session } = useAuth();
  const filters = useFilterRules(client, session?.user.id, session?.access_token);
  const [disableTarget, setDisableTarget] = useState<FilterRuleVersion>();
  const signedIn = session !== null;

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
      <ReceiptScreen title="Rules">
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
      </ReceiptScreen>
    );
  }

  return (
    <ReceiptScreen
      action={
        <AppButton
          accessibilityLabel="New rule"
          disabled={filters.saving}
          label="New"
          onPress={() => {
            filters.clearSaveError();
            router.push("/rules/editor");
          }}
        />
      }
      title="Rules"
    >
      <ContextualNotice accessibilityLabel="How rules are evaluated">
        Deterministic checks always run first. A rule reaches a model only for a clause they cannot
        decide, and only if you have configured a key.
      </ContextualNotice>

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
        <RuleRow
          busy={filters.saving}
          history={filters.historyFor(rule.seriesId)}
          key={rule.seriesId}
          onOpen={() => {
            filters.clearSaveError();
            router.push({ params: { seriesId: rule.seriesId }, pathname: "/rules/editor" });
          }}
          onToggleEnabled={() => setDisableTarget(rule)}
          revision={rule}
        />
      ))}

      <ConfirmationDialog
        confirmLabel={disableTarget?.enabled === true ? "Pause rule" : "Enable rule"}
        detail={
          disableTarget?.enabled === true
            ? "A paused rule stops deciding anything from now on. Its versions and past decisions are kept, and you can enable it again."
            : "This rule starts deciding again from now on. It does not reprocess anything already handled."
        }
        loading={filters.saving}
        onCancel={() => setDisableTarget(undefined)}
        onConfirm={() => void applyDisable()}
        title={disableTarget?.enabled === true ? "Pause this rule?" : "Enable this rule?"}
        visible={disableTarget !== undefined}
      />
    </ReceiptScreen>
  );
}
