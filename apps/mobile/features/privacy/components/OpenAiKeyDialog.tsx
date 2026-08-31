import type { SemanticResponseFormat } from "@relay/contracts";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Chip, Dialog, Portal } from "react-native-paper";

import { AppButton, AppText, AppTextInput, StatusMessage } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  openAiApiKeyError,
  openAiBaseUrlError,
  openAiEndpointPresets,
  openAiModelError,
  openAiPreset,
  openAiValuesForPreset,
  semanticDisclosureRules,
  semanticRedactionClasses,
  type OpenAiKeyFormValues,
} from "../models/openAiPresentation";

const RESPONSE_FORMATS: readonly { label: string; value: SemanticResponseFormat }[] = [
  { label: "Strict schema", value: "json-schema" },
  { label: "JSON object", value: "json-object" },
  { label: "No hint", value: "none" },
];

type OpenAiKeyDialogProps = {
  defaults: OpenAiKeyFormValues;
  errorMessage?: string | undefined;
  onDismiss: () => void;
  onSave: (values: OpenAiKeyFormValues) => Promise<void>;
  replacing: boolean;
  saving: boolean;
  visible: boolean;
};

export function OpenAiKeyDialog({
  defaults,
  errorMessage,
  onDismiss,
  onSave,
  replacing,
  saving,
  visible,
}: OpenAiKeyDialogProps) {
  const theme = useRelayTheme();
  const [values, setValues] = useState<OpenAiKeyFormValues>(defaults);
  const [attempted, setAttempted] = useState(false);

  // Reopening starts from the stored endpoint again, and never from a key: Relay does not return
  // stored key material, so the field is always empty at open.
  useEffect(() => {
    if (visible) {
      setValues(defaults);
      setAttempted(false);
    }
  }, [defaults, visible]);

  const preset = openAiPreset(values.presetId);
  const keyError = attempted ? openAiApiKeyError(values.apiKey) : undefined;
  const baseUrlError = attempted ? openAiBaseUrlError(values.baseUrl) : undefined;
  const modelError = attempted ? openAiModelError(values.model) : undefined;

  async function submit() {
    setAttempted(true);
    if (
      openAiApiKeyError(values.apiKey) !== undefined ||
      openAiBaseUrlError(values.baseUrl) !== undefined ||
      openAiModelError(values.model) !== undefined
    ) {
      return;
    }
    await onSave(values);
  }

  return (
    <Portal>
      <Dialog dismissable={!saving} onDismiss={onDismiss} visible={visible}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Dialog.Title>{replacing ? "Replace key" : "Add a key"}</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView contentContainerStyle={{ paddingVertical: theme.relay.spacing.md }}>
              <View style={{ gap: theme.relay.spacing.md }}>
                <AppText tone="muted">
                  Relay uses this key only when deterministic filters cannot decide a rule. Any
                  server speaking the OpenAI chat-completions protocol works.
                </AppText>

                <View style={{ gap: theme.relay.spacing.sm }}>
                  <AppText variant="label">Provider</AppText>
                  <View style={[styles.chips, { gap: theme.relay.spacing.sm }]}>
                    {openAiEndpointPresets.map((option) => (
                      <Chip
                        compact
                        key={option.id}
                        onPress={() => setValues(openAiValuesForPreset(option.id, values))}
                        selected={option.id === values.presetId}
                        showSelectedCheck={false}
                      >
                        {option.name}
                      </Chip>
                    ))}
                  </View>
                  <AppText tone="muted" variant="caption">
                    {preset.detail}
                  </AppText>
                </View>

                <AppTextInput
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  errorMessage={keyError}
                  label="API key"
                  maxLength={512}
                  onChangeText={(apiKey) => setValues({ ...values, apiKey })}
                  placeholder={preset.localOnly ? "Any non-empty value" : "Paste the provider key"}
                  secureTextEntry
                  value={values.apiKey}
                />

                <AppTextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  errorMessage={baseUrlError}
                  keyboardType="url"
                  label="Base URL"
                  maxLength={2048}
                  onChangeText={(baseUrl) => setValues({ ...values, baseUrl, presetId: "custom" })}
                  placeholder="https://api.example.com/v1"
                  value={values.baseUrl}
                />

                <AppTextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  errorMessage={modelError}
                  label="Model (optional)"
                  maxLength={128}
                  onChangeText={(model) => setValues({ ...values, model })}
                  placeholder="gpt-4.1-mini"
                  value={values.model}
                />

                <View style={{ gap: theme.relay.spacing.sm }}>
                  <AppText variant="label">Answer format</AppText>
                  <View style={[styles.chips, { gap: theme.relay.spacing.sm }]}>
                    {RESPONSE_FORMATS.map((option) => (
                      <Chip
                        compact
                        key={option.value}
                        onPress={() => setValues({ ...values, responseFormat: option.value })}
                        selected={option.value === values.responseFormat}
                        showSelectedCheck={false}
                      >
                        {option.label}
                      </Chip>
                    ))}
                  </View>
                  <AppText tone="muted" variant="caption">
                    How much the endpoint itself enforces. Relay checks every answer either way, so
                    a looser setting never widens what it accepts. Choose a looser one if requests
                    are refused.
                  </AppText>
                </View>

                <View style={{ gap: theme.relay.spacing.sm }}>
                  <AppText variant="label">What can be sent</AppText>
                  {semanticDisclosureRules.map((rule) => (
                    <AppText key={rule} tone="muted" variant="caption">
                      {rule}
                    </AppText>
                  ))}
                  <AppText tone="muted" variant="caption">
                    Removed before sending: {semanticRedactionClasses.join(", ").toLowerCase()}.
                  </AppText>
                </View>

                {errorMessage === undefined ? null : (
                  <StatusMessage tone="error">{errorMessage}</StatusMessage>
                )}
              </View>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <AppButton disabled={saving} label="Cancel" onPress={onDismiss} tone="secondary" />
            <AppButton
              label={replacing ? "Replace key" : "Save key"}
              loading={saving}
              onPress={() => void submit()}
            />
          </Dialog.Actions>
        </KeyboardAvoidingView>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap" },
});
