import { useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";

import { SourceSelectorScreen } from "@/features/device-capture/components/selector/SourceSelectorScreen";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { useTransactionalSelection } from "@/features/device-capture/hooks/useTransactionalSelection";
import {
  isValidSmsSenderAllowlist,
  normalizeSmsSender,
  saveSmsSenderAllowlist,
} from "@/lib/sms-capture";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

const INBOX_SYNC_FAILED_MESSAGE =
  "Contacts saved, but existing inbox sync failed. Retry to scan the inbox again.";

export default function SmsContactSelectorScreen() {
  const router = useRouter();
  const capture = useDeviceCaptureCapabilities();
  const savedSenders = capture.capabilities?.smsAllowedSenders ?? [];
  const selection = useTransactionalSelection(savedSenders);
  const operationInFlight = useRef(false);
  const pickerInFlight = useRef(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backAfterUnlock, setBackAfterUnlock] = useState(false);
  const [error, setError] = useState<string>();
  const interactionLocked = picking || saving;
  usePreventRemove(interactionLocked, () => undefined);
  useEffect(() => {
    if (interactionLocked || !backAfterUnlock) return;
    setBackAfterUnlock(false);
    router.back();
  }, [backAfterUnlock, interactionLocked, router]);
  const items = selection.draft.map((sender) => ({
    detail: labels[sender] === undefined ? undefined : sender,
    id: sender,
    label: labels[sender] ?? sender,
    searchText: `${labels[sender] ?? ""} ${sender}`,
    selected: true,
  }));

  function cancel() {
    if (operationInFlight.current || pickerInFlight.current) return;
    selection.cancel();
    router.back();
  }

  async function pickContact() {
    if (operationInFlight.current || pickerInFlight.current) return;
    pickerInFlight.current = true;
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
    } catch {
      setError("Could not open the Android contact picker.");
    } finally {
      pickerInFlight.current = false;
      setPicking(false);
    }
  }

  async function confirm() {
    if (operationInFlight.current || pickerInFlight.current) return;
    const tenantId = capture.mode.tenantId;
    const capabilities = capture.capabilities;
    const configuredSenders = [...selection.draft];
    if (
      tenantId === undefined ||
      capabilities === undefined ||
      !isValidSmsSenderAllowlist(configuredSenders)
    ) {
      setError("Choose at least one contact before saving.");
      return;
    }
    operationInFlight.current = true;
    setSaving(true);
    setError(undefined);
    let shouldNavigateBack = false;
    try {
      const result = await saveSmsSenderAllowlist({
        configure: (paused) =>
          RelayDeviceIngress.configureSmsCapture(tenantId, configuredSenders, paused),
        paused: capabilities.smsCapturePaused,
        syncInbox: () => RelayDeviceIngress.syncSmsInbox(tenantId),
      });
      selection.confirm(configuredSenders);
      if (result.inboxSync === "failed") {
        setError(INBOX_SYNC_FAILED_MESSAGE);
        return;
      }
      shouldNavigateBack = true;
    } catch {
      setError("Could not save the SMS contact allowlist.");
    } finally {
      operationInFlight.current = false;
      setSaving(false);
      if (shouldNavigateBack) setBackAfterUnlock(true);
    }
  }

  async function retryInboxSync() {
    if (operationInFlight.current || pickerInFlight.current) return;
    const tenantId = capture.mode.tenantId;
    if (tenantId === undefined) {
      setError(INBOX_SYNC_FAILED_MESSAGE);
      return;
    }
    operationInFlight.current = true;
    setSaving(true);
    setError(undefined);
    let shouldNavigateBack = false;
    try {
      await RelayDeviceIngress.syncSmsInbox(tenantId);
      shouldNavigateBack = true;
    } catch {
      setError(INBOX_SYNC_FAILED_MESSAGE);
    } finally {
      operationInFlight.current = false;
      setSaving(false);
      if (shouldNavigateBack) setBackAfterUnlock(true);
    }
  }

  return (
    <SourceSelectorScreen
      addAction={{
        label: "Choose contact in Android",
        loading: interactionLocked,
        onPress: () => void pickContact(),
      }}
      confirmDisabled={
        interactionLocked || !selection.changed || !isValidSmsSenderAllowlist(selection.draft)
      }
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
      loading={capture.capabilities === undefined || saving}
      onBack={cancel}
      onCancel={cancel}
      onConfirm={() => void confirm()}
      onQueryChange={setQuery}
      onRetry={
        error === INBOX_SYNC_FAILED_MESSAGE && !interactionLocked
          ? () => void retryInboxSync()
          : undefined
      }
      onToggle={(sender) => {
        if (operationInFlight.current || pickerInFlight.current) return;
        setError(undefined);
        selection.remove(sender);
      }}
      query={query}
      searchLabel="Search selected contacts"
      selectedCount={selection.draft.length}
      title="Manage contacts"
    />
  );
}
