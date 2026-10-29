import type { FilterRuleVersion } from "@relay/contracts";
import { router } from "expo-router";
import { useMemo, useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppSwitch,
  AppText,
  ConfirmationDialog,
  ContextualNotice,
  EditorialSurface,
  EmptyState,
  LoadingState,
  SectionHeading,
  StatusMessage,
} from "@/components/ui";
import { useCategoryManagement } from "@/features/categories/hooks/useCategoryManagement";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { RuleRow } from "@/features/filters/components/RuleRow";
import { useFilterRules } from "@/features/filters/hooks/useFilterRules";
import { filterDraftFor, filterSaveRequest } from "@/features/filters/models/filterPresentation";
import { useDeviceModel } from "@/features/privacy/hooks/useDeviceModel";
import { useNotificationSilence } from "@/features/silence/hooks/useNotificationSilence";
import { capabilityNotice, quietPill } from "@/features/silence/models/silencePresentation";
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
 * The rules deciding what happens to a capture, and to the notification it came from.
 *
 * A rule is a series rather than a setting, so the list shows which revision is running and how many
 * earlier ones are kept. Editing opens a screen, because a change appends a version and the plan it
 * compiles to deserves to be read before it is saved. Only the pause switch acts in place.
 *
 * What a rule does to a matching notification is chosen on the rule, in the editor, and shown on
 * its row here as a pill. The stop that halts every such rule at once sits at the top of this list,
 * because "reachable in one step from any screen showing dismissal" is the requirement and this is
 * the screen that shows it (ADR-0023). The stop is a halt, not an act: nothing on this tab can clear
 * or snooze a notification.
 */
export default function AutomationsScreen() {
  const { client, session } = useAuth();
  const tenantId = session?.user.id;
  const filters = useFilterRules(client, tenantId, session?.access_token);
  const categories = useCategoryManagement(client, tenantId);
  const silence = useNotificationSilence(client, tenantId);
  const { config: deviceModel } = useDeviceModel(tenantId);
  const { capabilities } = useDeviceCaptureCapabilities();
  const [disableTarget, setDisableTarget] = useState<FilterRuleVersion>();
  const signedIn = session !== null;

  // Resolved once for the whole list rather than per row: a rule names a category by id, and a row
  // that cannot say where a capture lands has to say "file it", which is true but much less useful.
  const categoryNames = useMemo(() => {
    const named = new Map<string, string>();
    for (const category of [...categories.activeCustom, ...categories.systemCategories]) {
      named.set(category.id, category.name);
    }
    return named;
  }, [categories.activeCustom, categories.systemCategories]);

  const active = filters.rules.filter((rule) => rule.enabled).length;
  const quieting = silence.statuses.some(
    (status) => status.stage === "acting" || status.stage === "observing",
  );
  const pillOptions = {
    killSwitchEngaged: silence.killSwitchEngaged,
    modelConfigured: deviceModel !== undefined,
  };
  // Only the warning case is worth a strip here. Until the first capability read lands, report the
  // state that promises least: a screen that briefly claims access it has not confirmed is worse
  // than one that waits a frame.
  const listenerNotice =
    quieting && capabilities !== undefined && !capabilities.notificationListener
      ? capabilityNotice({ notificationListener: false })
      : undefined;

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
          label="New rule"
          onPress={() => {
            filters.clearSaveError();
            router.push("/rules/editor");
          }}
        />
      }
      pill={filters.rules.length === 0 ? undefined : `${String(active)} active`}
      title="Rules"
    >
      <ContextualNotice accessibilityLabel="How rules are evaluated">
        Deterministic checks always run first. A rule reaches a model only for a clause they cannot
        decide, and only if you have set up a model on this phone or a key on your account.
      </ContextualNotice>

      {/*
        The stop comes before the list, not after it. It appears only once some rule can change a
        notification, or while it is engaged, so a reader whose rules only file never sees a control
        for a capability they have not granted.
      */}
      {quieting || silence.killSwitchEngaged ? (
        <EditorialSurface
          icon="hand-back-left-outline"
          meta={silence.killSwitchEngaged ? "Everything stopped" : "Running"}
          title="Stop clearing notifications"
        >
          <AppSwitch
            accessibilityHint="Stops every rule from changing any notification, on this phone immediately and on your account"
            detail={
              silence.killSwitchEngaged
                ? "No rule can change a notification while this is on. Your rules and their verdicts are kept."
                : "Rules are allowed to act on notifications. Turning this on halts all of them at once."
            }
            disabled={silence.stopping}
            label="Stop all rules"
            onValueChange={(value) => {
              void silence.engageStop(value);
            }}
            value={silence.killSwitchEngaged}
          />
          {silence.stopError !== null && (
            <StatusMessage tone="error">
              The stop was applied on this phone but could not be saved to your account. Your other
              devices may still be clearing notifications.
            </StatusMessage>
          )}
        </EditorialSurface>
      ) : null}

      {listenerNotice === undefined ? null : (
        <ContextualNotice
          accessibilityLabel="Notification access is needed before a rule can act"
          tone={listenerNotice.tone}
        >
          {listenerNotice.detail}
        </ContextualNotice>
      )}

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
          detail="Describe a rule in plain language. Relay shows the compiled predicates, the semantic clause, what it would disclose, and what it does to the notification before you save."
          title="No rules yet"
        />
      ) : null}

      {filters.rules.length === 0 ? null : <SectionHeading label="Your rules" />}

      {filters.rules.map((rule) => (
        <RuleRow
          busy={filters.saving}
          categoryName={
            rule.categoryId === undefined ? undefined : categoryNames.get(rule.categoryId)
          }
          history={filters.historyFor(rule.seriesId)}
          key={rule.seriesId}
          onOpen={() => {
            filters.clearSaveError();
            router.push({ params: { seriesId: rule.seriesId }, pathname: "/rules/editor" });
          }}
          onToggleEnabled={() => setDisableTarget(rule)}
          quiet={quietPill(silence.statusForSeries(rule.seriesId), pillOptions)}
          revision={rule}
        />
      ))}

      <ConfirmationDialog
        confirmLabel={disableTarget?.enabled === true ? "Pause rule" : "Enable rule"}
        detail={
          disableTarget?.enabled === true
            ? "A paused rule stops deciding anything from now on, and stops changing notifications. Its versions and past decisions are kept, and you can enable it again."
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
