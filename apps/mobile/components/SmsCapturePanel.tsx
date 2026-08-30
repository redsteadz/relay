import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useLocalCapturePreviews } from "@/hooks/useLocalCapturePreviews";
import { enableSmsCapture, isValidSmsSenderAllowlist, normalizeSmsSender } from "@/lib/sms-capture";
import { logMobileError, runInBackground } from "@/lib/observability";
import RelayDeviceIngress, {
  type DeviceCapabilities,
  type SmsCapturePreview,
} from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

import { LocalCaptureQueue } from "./LocalCaptureQueue";
import { Panel } from "./Panel";
import { AppButton, AppCheckbox, AppSwitch, AppText, StatusMessage } from "./ui";

type Props = {
  capabilities: DeviceCapabilities | undefined;
  developmentLocal: boolean;
  localPreviewEnabled: boolean;
  localPreviewError: string | undefined;
  tenantId: string | undefined;
  onChanged: () => Promise<void>;
};

export function SmsCapturePanel({
  capabilities,
  developmentLocal,
  localPreviewEnabled,
  localPreviewError,
  tenantId,
  onChanged,
}: Props) {
  const theme = useRelayTheme();
  const senderSelectionDirtyRef = useRef(false);
  const previewCountRef = useRef<number | undefined>(undefined);
  const [allowedSenders, setAllowedSenders] = useState<string[]>([]);
  const [draftSenders, setDraftSenders] = useState<string[]>([]);
  const [senderLabels, setSenderLabels] = useState<Record<string, string>>({});
  const [disclosed, setDisclosed] = useState(false);
  const [paused, setPaused] = useState(true);
  const [pendingAction, setPendingAction] = useState<"enable" | "save">();
  const [pickingContact, setPickingContact] = useState(false);
  const [setupVisible, setSetupVisible] = useState(false);
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    if (capabilities === undefined) return;
    if (!senderSelectionDirtyRef.current) {
      setAllowedSenders(capabilities.smsAllowedSenders);
      setSenderLabels((current) =>
        Object.fromEntries(
          capabilities.smsAllowedSenders.map((sender) => [sender, current[sender] ?? sender]),
        ),
      );
    }
    setPaused(capabilities.smsCapturePaused);
  }, [capabilities]);

  const loadLocalCaptures = useCallback(
    () =>
      tenantId === undefined
        ? Promise.resolve<SmsCapturePreview[]>([])
        : RelayDeviceIngress.getSmsCapturePreviews(tenantId),
    [tenantId],
  );
  const localPreview = useLocalCapturePreviews({
    enabled:
      localPreviewEnabled &&
      developmentLocal &&
      tenantId !== undefined &&
      capabilities?.smsAvailable === true,
    errorMessage: "Could not read the encrypted SMS queue.",
    load: loadLocalCaptures,
  });
  const draftValid = tenantId !== undefined && isValidSmsSenderAllowlist(draftSenders);
  const available = capabilities?.smsAvailable === true;

  useEffect(() => {
    if (!developmentLocal || !localPreviewEnabled || !available) {
      previewCountRef.current = undefined;
      return;
    }
    if (previewCountRef.current === localPreview.captures.length) return;
    previewCountRef.current = localPreview.captures.length;
    runInBackground(onChanged(), "background.sms_capabilities_refresh_failed", {
      code: "SMS_CAPABILITIES_REFRESH_FAILED",
      integration: "relay-device-ingress",
      operation: "refreshSmsCapabilities",
    });
  }, [available, developmentLocal, localPreview.captures.length, localPreviewEnabled, onChanged]);

  const meta = !available
    ? "NOT IN THIS BUILD"
    : !capabilities.smsPermissionGranted
      ? "NO ACCESS"
      : paused
        ? "PAUSED"
        : "ACTIVE";
  const disclosure = developmentLocal
    ? "Relay reads incoming SMS only from contacts you select, including the sender, message body, and received time. Matching messages are encrypted on this device and remain only in a local diagnostic queue. They are not uploaded. Relay does not read your contact list or outgoing messages. This access exists only in the internal sideload build."
    : "Relay reads incoming SMS only from contacts you select, including the sender, message body, and received time. Matching messages are encrypted on this device, uploaded to your Relay account, and deleted from raw server storage after seven days. Relay does not read your contact list or outgoing messages. This access exists only in the internal sideload build.";

  async function configure(senders: string[], nextPaused: boolean) {
    if (tenantId === undefined || !available || !isValidSmsSenderAllowlist(senders)) {
      return false;
    }
    await RelayDeviceIngress.configureSmsCapture(tenantId, senders, nextPaused);
    setPaused(nextPaused);
    return true;
  }

  function closeSetup() {
    senderSelectionDirtyRef.current = false;
    setDraftSenders(allowedSenders);
    setSetupVisible(false);
  }

  function reviewSetup() {
    senderSelectionDirtyRef.current = true;
    setDraftSenders(allowedSenders);
    setSetupVisible(true);
  }

  async function commitDraft() {
    setAllowedSenders(draftSenders);
    senderSelectionDirtyRef.current = false;
    await onChanged();
    setSetupVisible(false);
  }

  async function enableAndSync() {
    setStatus(undefined);
    if (!disclosed) {
      setStatus("Confirm the SMS disclosure before requesting access.");
      return;
    }
    if (!draftValid || tenantId === undefined || !available) {
      setStatus("Choose at least one contact before enabling SMS capture.");
      return;
    }

    setPendingAction("enable");
    try {
      const result = await enableSmsCapture({
        configure: (nextPaused) =>
          RelayDeviceIngress.configureSmsCapture(tenantId, draftSenders, nextPaused),
        permissionGranted: capabilities?.smsPermissionGranted === true,
        requestPermissions: () => RelayDeviceIngress.requestSmsPermissions(),
        syncInbox: () => RelayDeviceIngress.syncSmsInbox(tenantId),
      });
      setPaused(!result.granted);
      if (!result.granted) {
        await commitDraft();
        setStatus(
          "Selected contacts saved, but SMS access was not granted. Capture remains paused.",
        );
        return;
      }

      localPreview.refresh();
      await commitDraft();
      setStatus(`SMS capture enabled. ${result.captured.toString()} matching messages queued.`);
    } catch (error: unknown) {
      logMobileError("capture.sms_enable_failed", error, {
        code: "SMS_CAPTURE_ENABLE_FAILED",
        integration: "relay-device-ingress",
        operation: "enableSmsCapture",
      });
      setStatus("Could not enable SMS capture.");
    } finally {
      setPendingAction(undefined);
    }
  }

  async function saveControls() {
    setStatus(undefined);
    setPendingAction("save");
    try {
      if (!(await configure(draftSenders, true))) {
        setStatus("Choose at least one contact before saving controls.");
        return;
      }
      await commitDraft();
      setStatus("Selected contacts saved. SMS capture remains paused.");
    } catch (error: unknown) {
      logMobileError("capture.sms_controls_save_failed", error, {
        code: "SMS_CONTROLS_SAVE_FAILED",
        integration: "relay-device-ingress",
        operation: "saveSmsControls",
      });
      setStatus("Could not save SMS controls.");
    } finally {
      setPendingAction(undefined);
    }
  }

  async function chooseContact() {
    setStatus(undefined);
    setPickingContact(true);
    const wasDirty = senderSelectionDirtyRef.current;
    senderSelectionDirtyRef.current = true;
    try {
      const selectedContact = await RelayDeviceIngress.pickSmsSender();
      if (selectedContact === undefined) {
        senderSelectionDirtyRef.current = wasDirty;
        return;
      }
      const sender = normalizeSmsSender(selectedContact.sender);
      if (sender.length === 0) {
        setStatus("The selected contact has no usable phone number.");
        return;
      }
      if (!allowedSenders.includes(sender) && allowedSenders.length >= 50) {
        setStatus("Relay can capture SMS from at most 50 selected contacts.");
        return;
      }
      setDraftSenders(
        allowedSenders.includes(sender) ? allowedSenders : [...allowedSenders, sender],
      );
      setSenderLabels((current) => ({ ...current, [sender]: selectedContact.label }));
      setSetupVisible(true);
      setStatus("Contact selected. Review and save the SMS capture setup.");
    } catch (error: unknown) {
      logMobileError("capture.contact_picker_failed", error, {
        code: "CONTACT_PICKER_FAILED",
        integration: "relay-device-ingress",
        operation: "pickSmsContact",
      });
      setStatus("Could not open the system contact picker.");
    } finally {
      setPickingContact(false);
    }
  }

  function removeContact(sender: string) {
    if (allowedSenders.length === 1) {
      setStatus("SMS capture requires at least one configured contact.");
      return;
    }
    senderSelectionDirtyRef.current = true;
    setDraftSenders(allowedSenders.filter((candidate) => candidate !== sender));
    setSetupVisible(true);
    setStatus("Review and save to remove this contact from SMS capture.");
  }

  async function togglePause(nextPaused: boolean) {
    setStatus(undefined);
    if (!nextPaused && !disclosed) {
      setStatus("Confirm the SMS disclosure before resuming capture.");
      return;
    }
    if (!nextPaused && !capabilities?.smsPermissionGranted) {
      reviewSetup();
      return;
    }
    try {
      if (!(await configure(allowedSenders, nextPaused))) {
        setStatus("Choose at least one contact before updating capture.");
        return;
      }
      if (!nextPaused && tenantId !== undefined) await RelayDeviceIngress.syncSmsInbox(tenantId);
      await onChanged();
      setStatus(nextPaused ? "SMS capture paused." : "SMS capture resumed.");
    } catch (error: unknown) {
      logMobileError("capture.sms_pause_update_failed", error, {
        code: "SMS_CAPTURE_STATE_FAILED",
        integration: "relay-device-ingress",
        operation: "setSmsCapturePaused",
      });
      setStatus("Could not update SMS capture.");
    }
  }

  async function deleteQueuedSms() {
    if (tenantId === undefined) return;
    try {
      await RelayDeviceIngress.deleteQueuedSms(tenantId);
      await onChanged();
      setStatus("Queued SMS deleted from this device.");
    } catch (error: unknown) {
      logMobileError("capture.sms_queue_delete_failed", error, {
        code: "SMS_QUEUE_DELETE_FAILED",
        integration: "relay-device-ingress",
        operation: "deleteQueuedSms",
      });
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
      <StatusMessage tone="warning">{disclosure}</StatusMessage>
      {!available ? (
        <AppText tone="muted">
          This {capabilities?.buildVariant ?? "development"} build has no SMS permissions or SMS
          background entry points. Install the reviewed sideload APK to test SMS capture.
        </AppText>
      ) : (
        <>
          <View style={styles.selectorHeading}>
            <AppText variant="label">Configured SMS contacts</AppText>
            <AppText tone="accent" variant="eyebrow">
              {allowedSenders.length} SELECTED
            </AppText>
          </View>
          <AppText tone="muted" variant="caption">
            A number appears here only after its SMS capture setup is saved successfully.
          </AppText>
          <View accessibilityRole="list" style={styles.contactList}>
            {allowedSenders.length === 0 ? (
              <AppText tone="muted">No contacts selected.</AppText>
            ) : null}
            {allowedSenders.map((sender) => {
              const label = senderLabels[sender] ?? sender;
              return (
                <View
                  accessibilityLabel={`${label}, ${sender}`}
                  key={sender}
                  style={[
                    styles.contactRow,
                    {
                      backgroundColor: theme.relay.colors.accentSubtle,
                      borderColor: theme.relay.colors.accent,
                      borderRadius: theme.relay.radii.md,
                    },
                  ]}
                >
                  <View style={styles.contactCopy}>
                    <AppText variant="label">{label}</AppText>
                    {label === sender ? null : (
                      <AppText tone="muted" variant="caption">
                        {sender}
                      </AppText>
                    )}
                  </View>
                  <Pressable
                    accessibilityLabel={`Remove ${label}`}
                    accessibilityRole="button"
                    onPress={() => removeContact(sender)}
                    style={({ pressed }) => ({
                      opacity: pressed ? theme.relay.interaction.pressedOpacity : 1,
                      padding: theme.relay.spacing.sm,
                    })}
                  >
                    <AppText tone="danger" variant="label">
                      Remove
                    </AppText>
                  </Pressable>
                </View>
              );
            })}
          </View>
          <AppButton
            label={allowedSenders.length === 0 ? "Choose a contact" : "Choose another contact"}
            loading={pickingContact}
            onPress={() => void chooseContact()}
            tone="secondary"
          />
          <AppText tone="muted" variant="caption">
            Android shows the contact list. Relay receives only the contact row you select and does
            not request access to the full contacts database.
          </AppText>
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
          {allowedSenders.length > 0 ? (
            <AppButton label="Review and save SMS capture" onPress={reviewSetup} tone="secondary" />
          ) : null}
        </>
      )}
      <Modal animationType="fade" onRequestClose={closeSetup} transparent visible={setupVisible}>
        <View
          accessibilityViewIsModal
          style={[styles.modalBackdrop, { padding: theme.relay.spacing.lg }]}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.relay.colors.surface,
                borderColor: theme.relay.colors.border,
                borderRadius: theme.relay.radii.lg,
                gap: theme.relay.spacing.md,
                padding: theme.relay.spacing.lg,
              },
            ]}
          >
            <AppText variant="title">Save SMS capture contacts</AppText>
            <AppText tone="muted">
              Relay will capture incoming SMS only when its sender matches one of these selected
              phone numbers.
            </AppText>
            <ScrollView nestedScrollEnabled style={styles.modalContacts}>
              <View style={styles.contactList}>
                {draftSenders.map((sender) => {
                  const label = senderLabels[sender] ?? sender;
                  return (
                    <AppText key={sender} variant="label">
                      {label === sender ? sender : `${label} - ${sender}`}
                    </AppText>
                  );
                })}
              </View>
            </ScrollView>
            <AppCheckbox
              checked={disclosed}
              label="I understand exactly what SMS data Relay reads, uploads, retains, and excludes."
              onChange={setDisclosed}
            />
            <View style={styles.actions}>
              <AppButton
                disabled={pendingAction !== undefined}
                label="Cancel"
                onPress={closeSetup}
                tone="secondary"
              />
              <AppButton
                disabled={!draftValid || pendingAction !== undefined}
                label="Save paused"
                loading={pendingAction === "save"}
                onPress={() => void saveControls()}
                tone="secondary"
              />
              <AppButton
                disabled={!disclosed || !draftValid || pendingAction !== undefined}
                label={
                  capabilities?.smsPermissionGranted ? "Enable and sync" : "Grant access and sync"
                }
                loading={pendingAction === "enable"}
                onPress={() => void enableAndSync()}
              />
            </View>
          </View>
        </View>
      </Modal>
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
      {developmentLocal && available ? (
        <LocalCaptureQueue
          captures={localPreview.captures}
          description="Local diagnostic only. Relay decrypts these minimized fields while the Sources screen is visible. Nothing is copied to logs, app storage, or the network."
          emptyMessage="No pending SMS captures reached the queue yet."
          error={localPreviewError ?? localPreview.error}
          fields={(capture) => [
            { label: "Sender", value: capture.sender },
            { label: "Body", value: capture.body },
            { label: "Captured at", value: capture.capturedAt },
          ]}
          keyFor={(capture, index) => `${capture.capturedAt}-${index.toString()}`}
          onRefresh={localPreview.refresh}
          refreshLabel="Refresh pending SMS"
          refreshing={localPreview.refreshing}
          title="Encrypted SMS queue"
        />
      ) : null}
      {status === undefined ? null : (
        <StatusMessage
          tone={
            status.includes("enabled") ||
            status.includes("selected") ||
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
  contactCopy: { flex: 1, gap: 2, minWidth: 0 },
  contactList: { gap: 8 },
  contactRow: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.56)",
    flex: 1,
    justifyContent: "center",
  },
  modalCard: { borderWidth: 1, maxWidth: 520, width: "100%" },
  modalContacts: { maxHeight: 180 },
  queueControls: { alignItems: "flex-start", gap: 8 },
  selectorHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
});
