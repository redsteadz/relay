import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { isValidSmsSenderAllowlist, parseSmsSenderAllowlist } from "@/lib/sms-capture";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

import { Panel } from "./Panel";
import { AppButton, AppCheckbox, AppSwitch, AppText, AppTextInput, StatusMessage } from "./ui";

type Props = {
  capabilities: DeviceCapabilities | undefined;
  tenantId: string | undefined;
  onChanged: () => Promise<void>;
};

export function SmsCapturePanel({ capabilities, tenantId, onChanged }: Props) {
  const [allowedSenders, setAllowedSenders] = useState("");
  const [disclosed, setDisclosed] = useState(false);
  const [paused, setPaused] = useState(true);
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    if (capabilities === undefined) return;
    setAllowedSenders(capabilities.smsAllowedSenders.join("\n"));
    setPaused(capabilities.smsCapturePaused);
  }, [capabilities]);

  const senders = parseSmsSenderAllowlist(allowedSenders);
  const valid = tenantId !== undefined && isValidSmsSenderAllowlist(senders);
  const available = capabilities?.smsAvailable === true;
  const meta = !available
    ? "NOT IN THIS BUILD"
    : !capabilities.smsPermissionGranted
      ? "NO ACCESS"
      : paused
        ? "PAUSED"
        : "ACTIVE";

  async function configure(nextPaused: boolean) {
    if (!valid || tenantId === undefined || !available) return false;
    await RelayDeviceIngress.configureSmsCapture(tenantId, senders, nextPaused);
    setPaused(nextPaused);
    return true;
  }

  async function enableAndSync() {
    setStatus(undefined);
    if (!disclosed) {
      setStatus("Confirm the SMS disclosure before requesting access.");
      return;
    }
    if (!(await configure(true)) || tenantId === undefined) {
      setStatus("Add at least one exact sender before enabling SMS capture.");
      return;
    }
    try {
      const granted = await RelayDeviceIngress.requestSmsPermissions();
      if (!granted) {
        await onChanged();
        setStatus("SMS access was not granted. Capture remains paused.");
        return;
      }
      await RelayDeviceIngress.configureSmsCapture(tenantId, senders, false);
      setPaused(false);
      const captured = await RelayDeviceIngress.syncSmsInbox(tenantId);
      await onChanged();
      setStatus(`SMS capture enabled. ${captured.toString()} matching messages queued.`);
    } catch {
      setStatus("Could not enable SMS capture.");
    }
  }

  async function saveControls() {
    setStatus(undefined);
    try {
      if (!(await configure(paused)) || tenantId === undefined) {
        setStatus("Add at least one exact sender before saving controls.");
        return;
      }
      if (!paused && capabilities?.smsPermissionGranted) {
        await RelayDeviceIngress.syncSmsInbox(tenantId);
      }
      await onChanged();
      setStatus("SMS sender limits saved.");
    } catch {
      setStatus("Could not save SMS controls.");
    }
  }

  async function togglePause(nextPaused: boolean) {
    setStatus(undefined);
    if (!nextPaused && !disclosed) {
      setStatus("Confirm the SMS disclosure before resuming capture.");
      return;
    }
    if (!nextPaused && !capabilities?.smsPermissionGranted) {
      await enableAndSync();
      return;
    }
    try {
      if (!(await configure(nextPaused))) {
        setStatus("Add at least one exact sender before updating capture.");
        return;
      }
      if (!nextPaused && tenantId !== undefined) await RelayDeviceIngress.syncSmsInbox(tenantId);
      await onChanged();
      setStatus(nextPaused ? "SMS capture paused." : "SMS capture resumed.");
    } catch {
      setStatus("Could not update SMS capture.");
    }
  }

  async function deleteQueuedSms() {
    if (tenantId === undefined) return;
    try {
      await RelayDeviceIngress.deleteQueuedSms(tenantId);
      await onChanged();
      setStatus("Queued SMS deleted from this device.");
    } catch {
      setStatus("Could not delete queued SMS.");
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Delete queued SMS?",
      "This permanently removes encrypted SMS waiting on this device. Already uploaded items are not changed.",
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => void deleteQueuedSms(), style: "destructive", text: "Delete" },
      ],
    );
  }

  return (
    <Panel title="Android SMS" meta={meta}>
      <StatusMessage tone="warning">
        Relay reads incoming SMS only from senders you list, including the sender, message body, and
        received time. Matching messages are encrypted on this device, uploaded to your Relay
        account, and deleted from raw server storage after seven days. Relay does not read contacts
        or outgoing messages. This access exists only in the internal sideload build.
      </StatusMessage>
      {!available ? (
        <AppText tone="muted">
          This {capabilities?.buildVariant ?? "development"} build has no SMS permissions or SMS
          background entry points. Install the reviewed sideload APK to test SMS capture.
        </AppText>
      ) : (
        <>
          <AppTextInput
            accessibilityLabel="Allowed SMS senders"
            autoCapitalize="none"
            autoCorrect={false}
            errorMessage={
              allowedSenders.length > 0 && !isValidSmsSenderAllowlist(senders)
                ? "Enter 1–50 exact phone numbers or sender IDs, separated by commas or lines."
                : undefined
            }
            label="Allowed SMS senders"
            multiline
            onChangeText={setAllowedSenders}
            placeholder={"+1 555 010 0020\nExampleBank"}
            value={allowedSenders}
          />
          <AppSwitch
            accessibilityHint={
              disclosed ? undefined : "Confirm the SMS disclosure before resuming capture"
            }
            detail="Stops provider reads before any new SMS enters the encrypted queue."
            label="Pause SMS capture"
            onValueChange={(value) => void togglePause(value)}
            value={paused}
          />
          <AppCheckbox
            checked={disclosed}
            label="I understand exactly what SMS data Relay reads, uploads, retains, and excludes."
            onChange={setDisclosed}
          />
          <View style={styles.actions}>
            <AppButton
              disabled={!valid}
              label="Save sender limits"
              onPress={() => void saveControls()}
              tone="secondary"
            />
            <AppButton
              disabled={!disclosed || !valid}
              label={
                capabilities?.smsPermissionGranted ? "Enable and sync" : "Grant access and sync"
              }
              onPress={() => void enableAndSync()}
            />
          </View>
        </>
      )}
      <View style={styles.queueControls}>
        <AppText tone="muted">
          {`${(capabilities?.smsQueuedCount ?? 0).toString()} encrypted SMS queued on this device.`}
        </AppText>
        <AppButton
          disabled={tenantId === undefined || (capabilities?.smsQueuedCount ?? 0) === 0}
          label="Delete queued SMS"
          onPress={confirmDelete}
          tone="destructive"
        />
      </View>
      {status === undefined ? null : (
        <StatusMessage
          tone={
            status.includes("enabled") ||
            status.includes("saved") ||
            status.includes("paused") ||
            status.includes("resumed") ||
            status.includes("deleted")
              ? "success"
              : "error"
          }
        >
          {status}
        </StatusMessage>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  queueControls: { alignItems: "flex-start", gap: 8 },
});
