import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  isValidNotificationAllowlist,
  parseNotificationAllowlist,
} from "@/lib/notification-capture";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

import { Panel } from "./Panel";
import { AppButton, AppCheckbox, AppSwitch, AppText, AppTextInput, StatusMessage } from "./ui";

type Props = {
  capabilities: DeviceCapabilities | undefined;
  tenantId: string | undefined;
  onChanged: () => Promise<void>;
};

export function NotificationCapturePanel({ capabilities, tenantId, onChanged }: Props) {
  const [allowlist, setAllowlist] = useState("");
  const [disclosed, setDisclosed] = useState(false);
  const [paused, setPaused] = useState(true);
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    if (capabilities === undefined) return;
    setAllowlist(capabilities.notificationAllowedPackages.join(", "));
    setPaused(capabilities.notificationCapturePaused);
  }, [capabilities]);

  const packages = parseNotificationAllowlist(allowlist);
  const valid = tenantId !== undefined && isValidNotificationAllowlist(packages);

  async function save(nextPaused = paused) {
    if (!valid || tenantId === undefined) return false;
    await RelayDeviceIngress.configureNotificationCapture(tenantId, packages, nextPaused);
    setPaused(nextPaused);
    await onChanged();
    return true;
  }

  async function openSettings() {
    setStatus(undefined);
    try {
      if (!(await save(paused))) return;
      await RelayDeviceIngress.openNotificationAccessSettings();
    } catch {
      setStatus("Could not save notification controls.");
    }
  }

  async function saveControls() {
    setStatus(undefined);
    try {
      if (!(await save(paused))) setStatus("Add a valid app package before saving controls.");
      else setStatus("Notification controls saved.");
    } catch {
      setStatus("Could not save notification controls.");
    }
  }

  async function togglePause(value: boolean) {
    setStatus(undefined);
    if (!value && !disclosed) {
      setStatus("Confirm the disclosure before enabling capture.");
      return;
    }
    try {
      if (!(await save(value))) setStatus("Add a valid app package before enabling capture.");
    } catch {
      setStatus("Could not update capture state.");
    }
  }

  return (
    <Panel
      title="Android notifications"
      meta={capabilities?.notificationListener ? (paused ? "PAUSED" : "ACTIVE") : "NO ACCESS"}
    >
      <AppText>
        Relay can read the title and visible text of notifications from only the apps you list. It
        encrypts them on this device, uploads them to your Relay account, and deletes raw payloads
        after seven days. Relay never uploads the full extras bundle and cannot dismiss
        notifications.
      </AppText>
      <AppTextInput
        accessibilityLabel="Allowed Android package names"
        autoCapitalize="none"
        autoCorrect={false}
        errorMessage={
          !isValidNotificationAllowlist(packages) && allowlist.length > 0
            ? "Use exact package names such as com.example.bank."
            : undefined
        }
        label="Allowed Android package names"
        onChangeText={setAllowlist}
        placeholder="com.example.bank, com.example.delivery"
        value={allowlist}
      />
      <AppSwitch
        accessibilityHint={
          disclosed ? undefined : "Confirm the disclosure before enabling notification capture"
        }
        detail="Takes effect before any new item enters the upload queue."
        label="Pause notification capture"
        onValueChange={(value) => void togglePause(value)}
        value={paused}
      />
      <AppCheckbox
        checked={disclosed}
        label="I understand what Relay reads, uploads, retains, and cannot do."
        onChange={setDisclosed}
      />
      <View style={styles.actions}>
        <AppButton
          disabled={!valid}
          label="Save controls"
          onPress={() => void saveControls()}
          tone="secondary"
        />
        <AppButton
          disabled={!disclosed || !valid}
          label="Continue to system access"
          onPress={() => void openSettings()}
          tone="secondary"
        />
      </View>
      {status === undefined ? null : (
        <StatusMessage tone={status === "Notification controls saved." ? "success" : "error"}>
          {status}
        </StatusMessage>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
