import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  AppButton,
  AppDialog,
  AppSwitch,
  AppText,
  AppTextInput,
  StatusMessage,
} from "@/components/ui";
import { useRelayTheme } from "@/theme";
import type { FilterCategoryDescriptor } from "@relay/domain";

import {
  filterIntentError,
  filterNameError,
  previewFilterCompilation,
  syntheticPreviewItems,
  type FilterDraft,
  type PreviewItem,
} from "../models/filterPresentation";
import { FilterPlanSummary } from "./FilterPlanSummary";
import { FilterPreviewPanel } from "./FilterPreviewPanel";

type FilterEditorDialogProps = {
  /** Names and slugs the compiler resolves a `category` predicate against. */
  categories: readonly FilterCategoryDescriptor[];
  /**
   * Categories a rule can file into, with the identity actually stored.
   *
   * Separate from `categories` because the compiler matches a category by slug while a rule files
   * into one by id, and conflating the two would let a renamed category silently repoint a rule.
   */
  categoryOptions: readonly { id: string; name: string }[];
  defaults: FilterDraft;
  errorMessage?: string | undefined;
  onDismiss: () => void;
  onSave: (draft: FilterDraft) => Promise<void>;
  previewItems?: readonly PreviewItem[] | undefined;
  saving: boolean;
  visible: boolean;
};

export function FilterEditorDialog({
  categories,
  categoryOptions,
  defaults,
  errorMessage,
  onDismiss,
  onSave,
  previewItems,
  saving,
  visible,
}: FilterEditorDialogProps) {
  const theme = useRelayTheme();
  const [draft, setDraft] = useState<FilterDraft>(defaults);
  const [attempted, setAttempted] = useState(false);
  const editing = defaults.series !== undefined;

  useEffect(() => {
    if (visible) {
      setDraft(defaults);
      setAttempted(false);
    }
  }, [defaults, visible]);

  // Compiled on every keystroke because it is a pure, synchronous function over a bounded intent.
  // The plan on screen is therefore always the plan for the text on screen.
  const preview = previewFilterCompilation(draft.intent.trim(), categories);
  const nameError = attempted ? filterNameError(draft.name) : undefined;
  const intentError = attempted ? filterIntentError(draft.intent) : undefined;
  const items = previewItems ?? syntheticPreviewItems;

  async function submit() {
    setAttempted(true);
    if (
      filterNameError(draft.name) !== undefined ||
      filterIntentError(draft.intent) !== undefined
    ) {
      return;
    }
    await onSave(draft);
  }

  return (
    <AppDialog
      actions={
        <>
          <AppButton disabled={saving} label="Cancel" onPress={onDismiss} tone="secondary" />
          <AppButton
            label={editing ? "Save version" : "Create rule"}
            loading={saving}
            onPress={() => void submit()}
          />
        </>
      }
      dismissable={!saving}
      onDismiss={onDismiss}
      title={editing ? "Edit rule" : "New rule"}
      visible={visible}
    >
      <View style={{ gap: theme.relay.spacing.md }}>
        <AppText tone="muted">
          Describe the rule in plain language. Relay compiles it as you type and shows the exact
          behaviour below before anything is saved.
        </AppText>

        <AppTextInput
          errorMessage={nameError}
          label="Name"
          maxLength={80}
          onChangeText={(name) => setDraft({ ...draft, name })}
          value={draft.name}
        />

        <AppTextInput
          errorMessage={intentError}
          label="What should this match?"
          maxLength={4000}
          multiline
          onChangeText={(intent) => setDraft({ ...draft, intent })}
          placeholder="Receipts from my bank over 50 USD"
          value={draft.intent}
        />

        <View style={{ gap: theme.relay.spacing.xs }}>
          <AppText variant="label">Files into</AppText>
          <AppText tone="muted" variant="caption">
            Where a matching capture goes. A rule with no category still decides, but the capture is
            filed without one.
          </AppText>
          <View style={[styles.categories, { gap: theme.relay.spacing.xs }]}>
            <AppButton
              accessibilityHint="Files matching captures without naming a category"
              label="No category"
              onPress={() => setDraft({ ...draft, categoryId: undefined })}
              tone={draft.categoryId === undefined ? "primary" : "secondary"}
            />
            {categoryOptions.map((category) => (
              <AppButton
                accessibilityHint={`Files matching captures into ${category.name}`}
                key={category.id}
                label={category.name}
                onPress={() => setDraft({ ...draft, categoryId: category.id })}
                tone={draft.categoryId === category.id ? "primary" : "secondary"}
              />
            ))}
          </View>
        </View>

        <AppSwitch
          detail="A disabled rule keeps its history and stops deciding anything."
          label="Enabled"
          onValueChange={(enabled) => setDraft({ ...draft, enabled })}
          value={draft.enabled}
        />

        {preview.status === "incomplete" ? (
          <AppText tone="muted" variant="caption">
            {preview.message}
          </AppText>
        ) : (
          <>
            <FilterPlanSummary compilation={preview.compilation} />
            <AppText variant="label">Preview</AppText>
            <FilterPreviewPanel items={items} plan={preview.compilation.plan} />
          </>
        )}

        {editing ? (
          <AppText tone="muted" variant="caption">
            Saving adds a new version. The current one is kept and stays inspectable.
          </AppText>
        ) : null}

        {errorMessage === undefined ? null : (
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
        )}
      </View>
    </AppDialog>
  );
}

const styles = StyleSheet.create({
  // Wraps rather than scrolls sideways: a category off the edge of a row is one a person never
  // finds, and the list is short enough to read in full.
  categories: { flexDirection: "row", flexWrap: "wrap" },
});
