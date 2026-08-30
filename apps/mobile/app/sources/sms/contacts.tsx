import { useRouter } from "expo-router";
import { useState } from "react";

import { SourceSelectorScreen } from "@/features/device-capture/components/selector/SourceSelectorScreen";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { useTransactionalSelection } from "@/features/device-capture/hooks/useTransactionalSelection";
import { logMobileError } from "@/lib/observability";
import { isValidSmsSenderAllowlist, normalizeSmsSender } from "@/lib/sms-capture";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

export default function SmsContactSelectorScreen() {
  const router = useRouter();
  const capture = useDeviceCaptureCapabilities();
  const savedSenders = capture.capabilities?.smsAllowedSenders ?? [];
  const selection = useTransactionalSelection(savedSenders);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const items = selection.draft.map((sender) => ({
    detail: labels[sender] === undefined ? undefined : sender,
    id: sender,
    label: labels[sender] ?? sender,
    searchText: `${labels[sender] ?? ""} ${sender}`,
    selected: true,
  }));

  function cancel() {
    selection.cancel();
    router.back();
  }

  async function pickContact() {
    setPicking(true);
    setError(undefined);
    try {
      const choice = await RelayDeviceIngress.pickSmsSender();
      if (choice === undefined) return;
      const sender = normalizeSmsSender(choice.sender);
      if (sender.length === 0) {
        setError("The selected contact has no usable phone number.");
        return;
      }
      if (!selection.draft.includes(sender) && selection.draft.length >= 50) {
        setError("Relay can capture SMS from at most 50 selected contacts.");
        return;
      }
      selection.add(sender);
      setLabels((current) => ({ ...current, [sender]: choice.label }));
    } catch (error: unknown) {
      logMobileError("capture.contact_picker_failed", error, {
        code: "CONTACT_PICKER_FAILED",
        integration: "relay-device-ingress",
        operation: "pickSmsContact",
      });
      setError("Could not open the Android contact picker.");
    } finally {
      setPicking(false);
    }
  }

  async function confirm() {
    if (
      capture.mode.tenantId === undefined ||
      capture.capabilities === undefined ||
      !isValidSmsSenderAllowlist(selection.draft)
    ) {
      setError("Choose at least one contact before saving.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await RelayDeviceIngress.configureSmsCapture(
        capture.mode.tenantId,
        selection.draft,
        capture.capabilities.smsCapturePaused,
      );
      selection.confirm();
      router.back();
    } catch (error: unknown) {
      logMobileError("capture.sms_controls_save_failed", error, {
        code: "SMS_CONTROLS_SAVE_FAILED",
        integration: "relay-device-ingress",
        operation: "saveSmsControls",
      });
      setError("Could not save the SMS contact allowlist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SourceSelectorScreen
      addAction={{
        label: "Choose contact in Android",
        loading: picking,
        onPress: () => void pickContact(),
      }}
      confirmDisabled={!selection.changed || !isValidSmsSenderAllowlist(selection.draft)}
      confirmLabel="Save contacts"
      confirmLoading={saving}
      detail="Search the current draft here, or use Android's contact picker to add one contact row at a time."
      emptyMessage={
        query.trim().length > 0
          ? "No selected contacts match this search."
          : "No contacts selected yet."
      }
      error={error ?? capture.error}
      items={items}
      loading={capture.capabilities === undefined}
      onBack={cancel}
      onCancel={cancel}
      onConfirm={() => void confirm()}
      onQueryChange={setQuery}
      onToggle={selection.remove}
      query={query}
      searchLabel="Search selected contacts"
      selectedCount={selection.draft.length}
      title="Manage contacts"
    />
  );
}
