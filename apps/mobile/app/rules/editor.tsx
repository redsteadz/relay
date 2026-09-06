import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
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
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";

/**
 * One rule, its compiled plan, and a dry run against synthetic captures.
 *
 * A full screen rather than the dialog this used to be. The compiled plan and the dry run are the
 * substance of the editor -- they are what makes a rule inspectable before it decides anything --
 * and in a dialog they sat below the fold on a phone, behind a scroll inside a scroll, which is
 * where a person stops reading. Here the plan and the three outcomes are part of the page.
 *
 * Everything below the intent field is produced by `@relay/domain`, the same compiler and evaluator
 * the pipeline runs, so the preview cannot describe behaviour Relay would not actually have. The
 * server recompiles on save and stays authoritative.
 */
export default function RuleEditorScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const { seriesId } = useLocalSearchParams<{ seriesId?: string }>();
  const { client, session } = useAuth();
  const filters = useFilterRules(client, session?.user.id, session?.access_token);
  const categories = useCategoryManagement(client, session?.user.id);

  const existing =
    seriesId === undefined ? undefined : filters.rules.find((rule) => rule.seriesId === seriesId);
  const [draft, setDraft] = useState<FilterDraft | undefined>();
  const [attempted, setAttempted] = useState(false);

  // The stored revision arrives after the first paint, so the draft is seeded from it once rather
  // than held in sync: re-seeding on every render would discard what a person had typed.
  const current = draft ?? filterDraftFor(existing);
  const seeded = draft !== undefined || seriesId === undefined || existing !== undefined;

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

  function update(patch: Partial<FilterDraft>) {
    setDraft({ ...current, ...patch });
  }

  async function save() {
    setAttempted(true);
    if (
      filterNameError(current.name) !== undefined ||
      filterIntentError(current.intent) !== undefined
    ) {
      return;
    }
    try {
      await filters.save(filterSaveRequest(current));
      router.back();
    } catch (error: unknown) {
      // The fixed save message stays visible below; this only keeps the rejection observable.
      reportUnexpectedUiError(error, "ui.filter_rule_operation_failed", {
        code: "FILTER_RULE_UI_OPERATION_FAILED",
        integration: "relay-api",
        operation: "saveFilterRule",
      });
    }
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

      {existing === undefined ? null : (
        <AppText tone="muted" variant="caption">
          Saving appends v{String(nextVersion)}. v{String(existing.version)} is kept and stays
          inspectable.
        </AppText>
      )}

      {filters.saveError === null || filters.saveError === undefined ? null : (
        <StatusMessage tone="error">{filterSaveErrorMessage(filters.saveError)}</StatusMessage>
      )}

      <AppButton
        label={existing === undefined ? "Save v1" : `Save as v${String(nextVersion)}`}
        loading={filters.saving}
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
