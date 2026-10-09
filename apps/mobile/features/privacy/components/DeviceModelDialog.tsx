import type { SemanticResponseFormat } from "@relay/contracts";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "react-native-paper";

import { AppButton, AppDialog, AppText, AppTextInput, StatusMessage } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  deviceModelBaseUrlError,
  deviceModelError,
  deviceModelFormError,
  deviceModelKeyError,
  DEVICE_MODEL_PRESETS,
  type DeviceModelFormValues,
} from "../models/deviceModelPresentation";

/** A local server widely implements the JSON-object form and widely does not implement the strict one. */
const RESPONSE_FORMATS: readonly { label: string; value: SemanticResponseFormat }[] = [
  { label: "JSON object", value: "json-object" },
  { label: "Strict schema", value: "json-schema" },
  { label: "No hint", value: "none" },
];

type DeviceModelDialogProps = {
  configured: boolean;
  defaults: DeviceModelFormValues;
  errorMessage?: string | undefined;
  onDismiss: () => void;
  onSave: (values: DeviceModelFormValues) => Promise<void>;
  saving: boolean;
  visible: boolean;
};

export function DeviceModelDialog({
  configured,
  defaults,
  errorMessage,
  onDismiss,
  onSave,
  saving,
  visible,
}: DeviceModelDialogProps) {
  const theme = useRelayTheme();
  const [values, setValues] = useState<DeviceModelFormValues>(defaults);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (visible) {
      setValues(defaults);
      setAttempted(false);
    }
  }, [defaults, visible]);

  const baseUrlError = attempted ? deviceModelBaseUrlError(values.baseUrl) : undefined;
  const modelError = attempted ? deviceModelError(values.model) : undefined;
  const keyError = attempted ? deviceModelKeyError(values.apiKey) : undefined;

  return (
    <AppDialog
      actions={
        <>
          <AppButton disabled={saving} label="Cancel" onPress={onDismiss} tone="secondary" />
          <AppButton
            disabled={saving}
            label={saving ? "Saving..." : "Save"}
            loading={saving}
            onPress={() => {
              setAttempted(true);
              if (deviceModelFormError(values) !== undefined) return;
              void onSave(values);
            }}
          />
        </>
      }
      icon="brain"
      onDismiss={onDismiss}
      title="Model on this phone"
      visible={visible}
    >
      <View style={[styles.form, { gap: theme.relay.spacing.sm }]}>
        <AppText tone="muted" variant="caption">
          Relay asks this model directly from your phone. Nothing goes through Relay&apos;s servers,
          and the key stays on this device.
        </AppText>

        <View style={[styles.presets, { gap: theme.relay.spacing.xxs }]}>
          {DEVICE_MODEL_PRESETS.map((preset) => (
            <Chip
              compact
              key={preset.id}
              onPress={() => {
                setValues({
                  apiKey: values.apiKey,
                  baseUrl: preset.baseUrl,
                  model: preset.model,
                  responseFormat: preset.responseFormat,
                });
              }}
            >
              {preset.label}
            </Chip>
          ))}
        </View>

        <AppTextInput
          autoCapitalize="none"
          errorMessage={baseUrlError}
          label="Where it answers"
          onChangeText={(baseUrl) => setValues({ ...values, baseUrl })}
          placeholder="http://192.168.1.10:11434/v1"
          value={values.baseUrl}
        />
        <AppTextInput
          autoCapitalize="none"
          errorMessage={modelError}
          label="Model"
          onChangeText={(model) => setValues({ ...values, model })}
          placeholder="llama3.2:3b"
          value={values.model}
        />
        <AppTextInput
          autoCapitalize="none"
          errorMessage={keyError}
          label={configured ? "Key (leave blank to keep the saved one)" : "Key (optional)"}
          onChangeText={(apiKey) => setValues({ ...values, apiKey })}
          secureTextEntry
          value={values.apiKey}
        />
        <AppText tone="muted" variant="caption">
          Most models you run yourself need no key.
        </AppText>

        <View style={[styles.presets, { gap: theme.relay.spacing.xxs }]}>
          {RESPONSE_FORMATS.map((format) => (
            <Chip
              compact
              key={format.value}
              onPress={() => setValues({ ...values, responseFormat: format.value })}
              selected={values.responseFormat === format.value}
            >
              {format.label}
            </Chip>
          ))}
        </View>

        {errorMessage === undefined ? null : (
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
        )}
      </View>
    </AppDialog>
  );
}

const styles = StyleSheet.create({
  form: { width: "100%" },
  presets: { flexDirection: "row", flexWrap: "wrap" },
});
