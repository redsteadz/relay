import { compileNotificationSilenceRule } from "@relay/domain";
import { AppError } from "@relay/observability";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppSwitch,
  AppText,
  AppTextInput,
  LoadingState,
  StatusMessage,
} from "@/components/ui";
import { FilterPlanSummary } from "@/features/filters/components/FilterPlanSummary";
import { FilterPreviewPanel } from "@/features/filters/components/FilterPreviewPanel";
import { useFilterRules } from "@/features/filters/hooks/useFilterRules";
import {
  filterDraftChanged,
  filterDraftFor,
  filterIntentError,
  filterNameError,
  filterSaveErrorMessage,
  filterSaveRequest,
  previewFilterCompilation,
  syntheticPreviewItems,
  type FilterDraft,
} from "@/features/filters/models/filterPresentation";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";
import { useCategoryManagement } from "@/features/categories/hooks/useCategoryManagement";
import { useDeviceModel } from "@/features/privacy/hooks/useDeviceModel";
import { useDeviceModelJournal } from "@/features/privacy/hooks/useDeviceModelDiagnostics";
import { QuietRuleStage } from "@/features/silence/components/QuietRuleStage";
import { useNotificationSilence } from "@/features/silence/hooks/useNotificationSilence";
import {
  applicationsNamedBy,
  quietChoiceFor,
  quietStageState,
  type QuietChoice,
} from "@/features/silence/models/silencePresentation";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

/**
 * A revision id for compiling the quiet preview of a rule that has not been saved yet.
 *
 * The compiled rule carries the id only so the device can name which rule decided; the preview is
 * never published, so any well-formed id serves. A fixed one keeps the preview deterministic.
 */
const PREVIEW_RULE_ID = "00000000-0000-4000-8000-000000000000";

/** The safe message an `AppError` already carries, or a generic one for anything unclassified. */
function writeErrorMessage(error: unknown): string {
  return error instanceof AppError
    ? error.userMessage
    : "What this rule does to notifications could not be saved.";
}

/**
 * One rule, its compiled plan, a dry run against synthetic captures, and what it does to the
 * notification itself.
 *
 * A full screen rather than the dialog this used to be. The compiled plan and the dry run are the
 * substance of the editor -- they are what makes a rule inspectable before it decides anything --
 * and in a dialog they sat below the fold on a phone, behind a scroll inside a scroll, which is
 * where a person stops reading. Here the plan and the three outcomes are part of the page.
 *
 * Everything below the intent field is produced by `@relay/domain`, the same compiler and evaluator
 * the pipeline runs, so the preview cannot describe behaviour Relay would not actually have. The
 * server recompiles on save and stays authoritative.
 *
 * The last stage is what the rule does to a matching notification on the phone. It used to be a
 * separate screen under Settings; it is a property of the rule, so it is chosen here, from the same
 * compilation the device will run (ADR-0023). Saving applies it to the revision that was saved.
 */
export default function RuleEditorScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const { seriesId } = useLocalSearchParams<{ seriesId?: string }>();
  const { client, session } = useAuth();
  const tenantId = session?.user.id;
  const filters = useFilterRules(client, tenantId, session?.access_token);
  const categories = useCategoryManagement(client, tenantId);
  const silence = useNotificationSilence(client, tenantId);
  // A rule that asks a model decides nothing without one, so the stage has to know whether this
  // phone has an endpoint rather than describing an effect that cannot happen (ADR-0019).
  const { config: deviceModel } = useDeviceModel(tenantId);
  const journal = useDeviceModelJournal(tenantId);

  const existing =
    seriesId === undefined ? undefined : filters.rules.find((rule) => rule.seriesId === seriesId);
  const [draft, setDraft] = useState<FilterDraft | undefined>();
  const [quiet, setQuiet] = useState<QuietChoice | undefined>();
  const [attempted, setAttempted] = useState(false);
  const [applyError, setApplyError] = useState<unknown>(null);

  // The stored revision arrives after the first paint, so the draft is seeded from it once rather
  // than held in sync: re-seeding on every render would discard what a person had typed.
  const current = draft ?? filterDraftFor(existing);
  const seeded = draft !== undefined || seriesId === undefined || existing !== undefined;

  // The quiet choice follows the same rule: it tracks what is stored until the reader picks.
  const status = seriesId === undefined ? undefined : silence.statusForSeries(seriesId);
  const storedChoice = quietChoiceFor(status);
  const chosen = quiet ?? storedChoice;

  const descriptors = categories.activeCustom
    .concat(categories.systemCategories)
    .map((category) => ({ name: category.name, slug: category.slug }));
  const options = categories.activeCustom
    .concat(categories.systemCategories)
    .map((category) => ({ id: category.id, name: category.name }));

  // Compiled on every keystroke because it is a pure, synchronous function over a bounded intent.
  // The plan on screen is therefore always the plan for the text on screen.
  const preview = previewFilterCompilation(current.intent.trim(), descriptors);
  const nameError = attempted ? filterNameError(current.name) : undefined;
  const intentError = attempted ? filterIntentError(current.intent) : undefined;
  const nextVersion = existing === undefined ? 1 : existing.version + 1;

  // The same compiler the device plan runs, over the draft's own plan, so the stage promises only
  // what the saved rule will be able to do.
  const quietCompilation = useMemo(
    () =>
      preview.status === "compiled"
        ? compileNotificationSilenceRule(preview.compilation.plan, {
            action: chosen === "dismiss" ? "dismiss" : "snooze",
            filterRuleId: existing?.id ?? PREVIEW_RULE_ID,
            observing: chosen === "observe",
          })
        : undefined,
    [chosen, existing?.id, preview],
  );
  const quietState = quietStageState({
    choice: chosen,
    compilation: quietCompilation,
    enabled: current.enabled,
    killSwitchEngaged: silence.killSwitchEngaged,
    modelConfigured: deviceModel !== undefined,
  });
  const applications =
    quietCompilation?.status === "compiled" ? applicationsNamedBy(quietCompilation.rule) : [];

  // Every revision of this series, because a verdict names the revision that produced it and an
  // earlier revision's verdicts are still this rule's history.
  const outcomes = useMemo(() => {
    if (seriesId === undefined) return [];
    const revisionIds = new Set(filters.historyFor(seriesId).map((revision) => revision.id));
    return silence.outcomes.filter(
      (outcome) => outcome.filterRuleId !== undefined && revisionIds.has(outcome.filterRuleId),
    );
  }, [filters, seriesId, silence.outcomes]);
  const latestQuietPass = journal.find((report) => report.kind === "quiet");

  function update(patch: Partial<FilterDraft>) {
    setDraft({ ...current, ...patch });
  }

  /**
   * Saves the rule, then applies what it does to notifications to the revision that was saved.
   *
   * A revision is appended only when the rule itself changed, or when leaving a watched rule alone
   * needs one -- an observation window has no routine to close it short of a new revision, which
   * withdraws everything by construction. A choice that is merely re-stated is not re-applied:
   * restarting a watch would discard the verdicts the reader has been reading.
   */
  async function save() {
    setAttempted(true);
    setApplyError(null);
    if (
      filterNameError(current.name) !== undefined ||
      filterIntentError(current.intent) !== undefined
    ) {
      return;
    }
    const effective: QuietChoice = quietState.blocked === undefined ? chosen : "none";
    const draftChanged = existing === undefined || filterDraftChanged(existing, current);
    const needsRevision = draftChanged || (effective === "none" && storedChoice === "observe");

    let ruleId = existing?.id;
    try {
      if (needsRevision) {
        const saved = await filters.save(filterSaveRequest(current));
        ruleId = saved.rule.id;
      }
    } catch (error: unknown) {
      // The fixed save message stays visible below; this only keeps the rejection observable.
      reportUnexpectedUiError(error, "ui.filter_rule_operation_failed", {
        code: "FILTER_RULE_UI_OPERATION_FAILED",
        integration: "relay-api",
        operation: "saveFilterRule",
      });
      return;
    }

    try {
      if (
        ruleId !== undefined &&
        effective !== "none" &&
        (needsRevision || effective !== storedChoice)
      ) {
        await silence.applyChoice({
          choice: effective,
          filterRuleId: ruleId,
          observingSince: needsRevision ? undefined : status?.rule.dryRunStartedAt,
        });
      } else if (
        ruleId !== undefined &&
        effective === "none" &&
        !needsRevision &&
        storedChoice !== "none"
      ) {
        await silence.applyChoice({ choice: "none", filterRuleId: ruleId });
      }
    } catch (error: unknown) {
      // The rule itself is saved by now. Staying on the screen with the reason is better than
      // leaving with the stage silently reverted.
      reportUnexpectedUiError(error, "ui.filter_rule_operation_failed", {
        code: "FILTER_RULE_QUIET_NOT_APPLIED",
        integration: "supabase-postgrest",
        operation: "applyQuietChoice",
      });
      setApplyError(error);
      return;
    }
    router.back();
  }

  return (
    <ReceiptScreen
      onBack={() => router.back()}
      title={existing === undefined ? "New rule" : "Edit rule"}
    >
      {!seeded ? <LoadingState label="Reading this rule..." /> : null}

      <AppText tone="muted" variant="monoMeta">
        {existing === undefined
          ? "V1 · NEW SERIES"
          : `V${String(existing.version)} → V${String(nextVersion)}`}
      </AppText>

      <ReceiptStage label="What it is called" ordinal={1}>
        <AppTextInput
          errorMessage={nameError}
          label="Name"
          maxLength={80}
          onChangeText={(name) => update({ name })}
          value={current.name}
        />
      </ReceiptStage>

      <ReceiptStage label="What it should match" ordinal={2}>
        <AppTextInput
          errorMessage={intentError}
          label="Describe it in plain language"
          maxLength={4000}
          multiline
          onChangeText={(intent) => update({ intent })}
          placeholder="Receipts from my bank over 50 USD"
          value={current.intent}
        />
        <AppText tone="muted" variant="caption">
          Relay compiles this as you type. Everything below is the exact behaviour it would have.
        </AppText>
      </ReceiptStage>

      <ReceiptStage label="How it compiles" ordinal={3}>
        {preview.status === "incomplete" ? (
          <AppText tone="muted" variant="caption">
            {preview.message}
          </AppText>
        ) : (
          <FilterPlanSummary compilation={preview.compilation} />
        )}
      </ReceiptStage>

      <ReceiptStage label="Dry run" ordinal={4}>
        {preview.status === "incomplete" ? (
          <AppText tone="muted" variant="caption">
            Nothing to run yet.
          </AppText>
        ) : (
          <FilterPreviewPanel items={syntheticPreviewItems} plan={preview.compilation.plan} />
        )}
      </ReceiptStage>

      <ReceiptStage label="Where it files" ordinal={5}>
        <AppText tone="muted" variant="caption">
          Where a matching capture goes. A rule with no category still decides, but the capture is
          filed without one.
        </AppText>
        <View style={[styles.categories, { gap: theme.relay.spacing.xs }]}>
          <AppButton
            accessibilityHint="Files matching captures without naming a category"
            label="No category"
            onPress={() => update({ categoryId: undefined })}
            tone={current.categoryId === undefined ? "primary" : "secondary"}
          />
          {options.map((category) => (
            <AppButton
              accessibilityHint={`Files matching captures into ${category.name}`}
              key={category.id}
              label={category.name}
              onPress={() => update({ categoryId: category.id })}
              tone={current.categoryId === category.id ? "primary" : "secondary"}
            />
          ))}
        </View>
        <AppSwitch
          detail="A paused rule keeps its history and stops deciding anything."
          label="Enabled"
          onValueChange={(enabled) => update({ enabled })}
          value={current.enabled}
        />
      </ReceiptStage>

      <ReceiptStage label="What it does to the notification" ordinal={6}>
        <QuietRuleStage
          applications={applications}
          choice={quietState.blocked === undefined ? chosen : "none"}
          disabled={filters.saving || silence.applying}
          latestPass={latestQuietPass}
          onChoose={setQuiet}
          outcomes={outcomes}
          state={quietState}
        />
      </ReceiptStage>

      {existing === undefined ? null : (
        <AppText tone="muted" variant="caption">
          {`Saving a changed rule appends v${String(nextVersion)}. v${String(existing.version)} is kept and stays inspectable. Changing only what it does to notifications keeps v${String(existing.version)}.`}
        </AppText>
      )}

      {filters.saveError === null || filters.saveError === undefined ? null : (
        <StatusMessage tone="error">{filterSaveErrorMessage(filters.saveError)}</StatusMessage>
      )}
      {applyError === null ? null : (
        <StatusMessage tone="error">
          {`The rule was saved, but ${writeErrorMessage(applyError).replace(/^./u, (first) => first.toLowerCase())} Nothing on your phone was altered.`}
        </StatusMessage>
      )}

      <AppButton
        label={existing === undefined ? "Save v1" : "Save"}
        loading={filters.saving || silence.applying}
        onPress={() => void save()}
      />
    </ReceiptScreen>
  );
}

const styles = StyleSheet.create({
  // Wraps rather than scrolls sideways: a category off the edge of a row is one a person never
  // finds, and the list is short enough to read in full.
  categories: { flexDirection: "row", flexWrap: "wrap" },
});
