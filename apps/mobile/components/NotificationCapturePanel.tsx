import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import {
  isValidNotificationAllowlist,
  parseNotificationAllowlist,
} from "@/lib/notification-capture";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

import { palette } from "./Page";
import { Panel } from "./Panel";

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
      <Text style={styles.disclosure}>
        Relay can read the title and visible text of notifications from only the apps you list. It
        encrypts them on this device, uploads them to your Relay account, and deletes raw payloads
        after seven days. Relay never uploads the full extras bundle and cannot dismiss
        notifications.
      </Text>
      <Text style={styles.label}>Allowed Android package names</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setAllowlist}
        placeholder="com.example.bank, com.example.delivery"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={allowlist}
      />
      <View style={styles.controlRow}>
        <View style={styles.controlCopy}>
          <Text style={styles.label}>Pause capture</Text>
          <Text style={styles.copy}>Takes effect before any new item enters the upload queue.</Text>
        </View>
        <Switch
          accessibilityHint={
            disclosed ? undefined : "Confirm the disclosure before enabling notification capture"
          }
          accessibilityLabel="Pause notification capture"
          onValueChange={(value) => void togglePause(value)}
          value={paused}
        />
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: disclosed }}
        onPress={() => setDisclosed((value) => !value)}
        style={styles.checkRow}
      >
        <Text style={styles.check}>{disclosed ? "[x]" : "[ ]"}</Text>
        <Text style={styles.copy}>
          I understand what Relay reads, uploads, retains, and cannot do.
        </Text>
      </Pressable>
      {!isValidNotificationAllowlist(packages) && allowlist.length > 0 ? (
        <Text style={styles.error}>Use exact package names such as com.example.bank.</Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={!valid}
          onPress={() => void saveControls()}
          style={[styles.button, !valid && styles.disabled]}
        >
          <Text style={styles.buttonText}>Save controls</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!disclosed || !valid}
          onPress={() => void openSettings()}
          style={[styles.button, (!disclosed || !valid) && styles.disabled]}
        >
          <Text style={styles.buttonText}>Continue to system access</Text>
        </Pressable>
      </View>
      {status === undefined ? null : <Text style={styles.error}>{status}</Text>}
    </Panel>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: {
    alignSelf: "flex-start",
    borderColor: palette.accent,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  buttonText: { color: palette.accent, fontSize: 13, fontWeight: "700" },
  check: { color: palette.accent, fontSize: 20 },
  checkRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  controlCopy: { flex: 1, gap: 3 },
  controlRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  copy: { color: palette.muted, flex: 1, fontSize: 13, lineHeight: 19 },
  disclosure: { color: palette.text, fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.35 },
  error: { color: palette.amber, fontSize: 13, lineHeight: 19 },
  input: {
    borderColor: palette.border,
    borderRadius: 10,
    borderWidth: 1,
    color: palette.text,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  label: { color: palette.text, fontSize: 13, fontWeight: "700" },
});
