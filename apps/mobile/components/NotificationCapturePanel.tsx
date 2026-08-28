import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  filterNotificationAppChoices,
  isValidNotificationAllowlist,
  normalizeNotificationAppChoices,
  toggleNotificationAppSelection,
} from "@/lib/notification-capture";
import RelayDeviceIngress, {
  type DeviceCapabilities,
  type NotificationCapturePreview,
  type SelectableNotificationApp,
} from "@/modules/relay-device-ingress";

import { palette } from "./Page";
import { Panel } from "./Panel";

type Props = {
  capabilities: DeviceCapabilities | undefined;
  developmentLocal: boolean;
  tenantId: string | undefined;
  onChanged: () => Promise<void>;
};

const LOCAL_QUEUE_POLL_MS = 3_000;

export function NotificationCapturePanel({
  capabilities,
  developmentLocal,
  tenantId,
  onChanged,
}: Props) {
  const [allowedPackages, setAllowedPackages] = useState<string[]>([]);
  const [appSearch, setAppSearch] = useState("");
  const [selectableApps, setSelectableApps] = useState<SelectableNotificationApp[]>([]);
  const [appListLoading, setAppListLoading] = useState(false);
  const [appListStatus, setAppListStatus] = useState<string>();
  const [disclosed, setDisclosed] = useState(false);
  const [paused, setPaused] = useState(true);
  const [status, setStatus] = useState<string>();
  const [localCaptures, setLocalCaptures] = useState<NotificationCapturePreview[]>([]);
  const [localQueueRefreshing, setLocalQueueRefreshing] = useState(false);
  const [localQueueStatus, setLocalQueueStatus] = useState<string>();
  const previewLifecycleRef = useRef({ active: false, generation: 0 });
  const previewRefreshRunningRef = useRef(false);
  const previewRefreshPendingRef = useRef(false);
  const secureWindowGenerationRef = useRef(0);

  useEffect(() => {
    if (capabilities === undefined) return;
    setAllowedPackages(capabilities.notificationAllowedPackages);
    setPaused(capabilities.notificationCapturePaused);
  }, [capabilities]);

  useFocusEffect(
    useCallback(() => {
      if (capabilities?.platform === undefined) return undefined;
      let active = true;
      let generation = 0;

      const refresh = async () => {
        const currentGeneration = ++generation;
        setAppListLoading(true);
        setAppListStatus(undefined);
        try {
          const apps = await RelayDeviceIngress.getSelectableNotificationApps();
          if (active && currentGeneration === generation) setSelectableApps(apps);
        } catch {
          if (active && currentGeneration === generation) {
            setAppListStatus("Could not load launchable apps.");
          }
        } finally {
          if (active && currentGeneration === generation) setAppListLoading(false);
        }
      };

      void refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        active = false;
        generation += 1;
        subscription.remove();
      };
    }, [capabilities?.platform]),
  );

  const selectablePackages = useMemo(
    () => new Set(selectableApps.map((app) => app.packageName)),
    [selectableApps],
  );
  const appChoices = useMemo(
    () =>
      normalizeNotificationAppChoices([
        ...selectableApps,
        ...allowedPackages
          .filter((packageName) => !selectablePackages.has(packageName))
          .map((packageName) => ({ label: packageName, packageName })),
      ]),
    [allowedPackages, selectableApps, selectablePackages],
  );
  const filteredAppChoices = useMemo(
    () => filterNotificationAppChoices(appChoices, appSearch),
    [appChoices, appSearch],
  );
  const valid = tenantId !== undefined && isValidNotificationAllowlist(allowedPackages);

  const clearLocalCapturePreviews = useCallback(() => {
    previewLifecycleRef.current.active = false;
    previewLifecycleRef.current.generation += 1;
    previewRefreshPendingRef.current = false;
    setLocalCaptures([]);
    setLocalQueueRefreshing(false);
    setLocalQueueStatus(undefined);
  }, []);

  const refreshLocalCaptures = useCallback(async () => {
    if (!developmentLocal || tenantId === undefined || !previewLifecycleRef.current.active) {
      return;
    }
    if (previewRefreshRunningRef.current) {
      previewRefreshPendingRef.current = true;
      return;
    }

    previewRefreshRunningRef.current = true;
    try {
      do {
        previewRefreshPendingRef.current = false;
        if (!previewLifecycleRef.current.active) break;
        const generation = previewLifecycleRef.current.generation;
        setLocalQueueRefreshing(true);
        setLocalQueueStatus(undefined);
        try {
          const captures = await RelayDeviceIngress.getNotificationCapturePreviews(tenantId);
          if (
            previewLifecycleRef.current.active &&
            previewLifecycleRef.current.generation === generation
          ) {
            setLocalCaptures(captures);
          }
        } catch {
          if (
            previewLifecycleRef.current.active &&
            previewLifecycleRef.current.generation === generation
          ) {
            setLocalCaptures([]);
            setLocalQueueStatus("Could not read the encrypted native queue.");
          }
        }
      } while (previewRefreshPendingRef.current && previewLifecycleRef.current.active);
    } finally {
      previewRefreshRunningRef.current = false;
      if (previewLifecycleRef.current.active) setLocalQueueRefreshing(false);
    }
  }, [developmentLocal, tenantId]);

  useFocusEffect(
    useCallback(() => {
      if (!developmentLocal || tenantId === undefined) {
        clearLocalCapturePreviews();
        return undefined;
      }

      let focused = true;
      let foreground = AppState.currentState === "active";
      let secureWindowEnabled = false;
      const secureWindowGeneration = ++secureWindowGenerationRef.current;

      const activate = () => {
        if (!focused || !foreground || !secureWindowEnabled) return;
        previewLifecycleRef.current.active = true;
        previewLifecycleRef.current.generation += 1;
        void refreshLocalCaptures();
      };
      const deactivate = () => clearLocalCapturePreviews();

      deactivate();
      void RelayDeviceIngress.setNotificationCapturePreviewSecure(true)
        .then(() => {
          if (!focused || secureWindowGenerationRef.current !== secureWindowGeneration) {
            return;
          }
          secureWindowEnabled = true;
          activate();
        })
        .catch(() => {
          if (!focused) return;
          deactivate();
          setLocalQueueStatus("Secure local preview is unavailable.");
        });

      const subscription = AppState.addEventListener("change", (state) => {
        foreground = state === "active";
        if (foreground) activate();
        else deactivate();
      });
      const interval = setInterval(() => void refreshLocalCaptures(), LOCAL_QUEUE_POLL_MS);
      return () => {
        focused = false;
        secureWindowEnabled = false;
        deactivate();
        subscription.remove();
        clearInterval(interval);
        const cleanupGeneration = ++secureWindowGenerationRef.current;
        requestAnimationFrame(() => {
          if (secureWindowGenerationRef.current !== cleanupGeneration) return;
          void RelayDeviceIngress.setNotificationCapturePreviewSecure(false).catch(() => undefined);
        });
      };
    }, [clearLocalCapturePreviews, developmentLocal, refreshLocalCaptures, tenantId]),
  );

  async function save(nextPaused = paused) {
    if (!valid || tenantId === undefined) return false;
    await RelayDeviceIngress.configureNotificationCapture(tenantId, allowedPackages, nextPaused);
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

  function toggleApp(packageName: string) {
    setStatus(undefined);
    setAllowedPackages((packages) => toggleNotificationAppSelection(packages, packageName));
  }

  return (
    <Panel
      title="Android notifications"
      meta={capabilities?.notificationListener ? (paused ? "PAUSED" : "ACTIVE") : "NO ACCESS"}
    >
      <Text style={styles.disclosure}>
        Relay can read the title and visible text of notifications from only the apps you list. It
        {developmentLocal
          ? " encrypts them in a separate on-device queue and does not upload them."
          : " encrypts them on this device and uploads them to your Relay account."}{" "}
        Raw payloads are deleted after seven days. Relay never uploads the full extras bundle and
        cannot dismiss notifications.
      </Text>
      {developmentLocal ? (
        <Text style={styles.localNotice}>
          Development-only local mode. Local captures are deleted before authenticated sync starts;
          save these controls again after authentication to enable uploads.
        </Text>
      ) : null}
      <View style={styles.selectorHeading}>
        <Text style={styles.label}>Apps Relay may capture</Text>
        <Text style={styles.queueCount}>{allowedPackages.length} SELECTED</Text>
      </View>
      <Text style={styles.copy}>
        Choose from launchable Android apps. Installed app labels and the full app list stay on this
        device and are never logged or uploaded.
      </Text>
      <Text style={styles.copy}>
        {developmentLocal
          ? "Selected package IDs remain in local capture configuration."
          : "Each selected package ID is attached to its authenticated capture as provenance and uploaded with that capture."}
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search launchable Android apps"
        onChangeText={setAppSearch}
        placeholder="Search app name or package"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={appSearch}
      />
      <ScrollView nestedScrollEnabled style={styles.appListViewport}>
        <View accessibilityRole="list" style={styles.appList}>
          {appListLoading ? <Text style={styles.copy}>Loading launchable apps...</Text> : null}
          {!appListLoading && filteredAppChoices.length === 0 ? (
            <Text style={styles.copy}>
              {appSearch.trim().length > 0
                ? "No launchable apps match this search."
                : "No launchable Android apps available."}
            </Text>
          ) : null}
          {filteredAppChoices.map((app) => {
            const selected = allowedPackages.includes(app.packageName);
            const unavailable = !selectablePackages.has(app.packageName);
            return (
              <Pressable
                accessibilityLabel={`${app.label}, ${app.packageName}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={app.packageName}
                onPress={() => toggleApp(app.packageName)}
                style={[styles.appRow, selected && styles.appRowSelected]}
              >
                <Text style={styles.check}>{selected ? "[x]" : "[ ]"}</Text>
                <View style={styles.appCopy}>
                  <Text style={styles.appLabel}>{app.label}</Text>
                  {app.label === app.packageName ? null : (
                    <Text style={styles.packageName}>{app.packageName}</Text>
                  )}
                  {unavailable ? (
                    <Text style={styles.unavailable}>
                      Saved selection - not currently launchable
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      {appListStatus === undefined ? null : <Text style={styles.error}>{appListStatus}</Text>}
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
      {!isValidNotificationAllowlist(allowedPackages) ? (
        <Text style={styles.error}>Choose at least one app before saving controls.</Text>
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
      {developmentLocal ? (
        <View style={styles.localQueue}>
          <View style={styles.queueHeading}>
            <Text style={styles.label}>Encrypted native queue</Text>
            <Text style={styles.queueCount}>{localCaptures.length} PENDING</Text>
          </View>
          <Text style={styles.copy}>
            Development-local diagnostic. Relay decrypts these minimized fields only while this
            panel is visible. Nothing is copied to logs, app storage, or network.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={localQueueRefreshing}
            onPress={() => void refreshLocalCaptures()}
            style={[styles.button, localQueueRefreshing && styles.disabled]}
          >
            <Text style={styles.buttonText}>
              {localQueueRefreshing ? "Refreshing..." : "Refresh pending captures"}
            </Text>
          </Pressable>
          {localQueueStatus === undefined ? null : (
            <Text style={styles.error}>{localQueueStatus}</Text>
          )}
          {!localQueueRefreshing && localCaptures.length === 0 ? (
            <Text style={styles.copy}>No pending notification captures reached the queue yet.</Text>
          ) : null}
          {localCaptures.map((capture, index) => (
            <View
              key={`${capture.capturedAt}-${capture.applicationId ?? "unknown"}-${index.toString()}`}
              style={styles.capture}
            >
              <Text style={styles.captureField}>Sender: {capture.sender ?? "Not available"}</Text>
              <Text style={styles.captureField}>Subject: {capture.subject ?? "Not available"}</Text>
              <Text style={styles.captureField}>Body: {capture.body ?? "Not available"}</Text>
              <Text style={styles.captureField}>
                Application ID: {capture.applicationId ?? "Not available"}
              </Text>
              <Text style={styles.captureField}>Captured at: {capture.capturedAt}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  appCopy: { flex: 1, gap: 2, minWidth: 0 },
  appLabel: { color: palette.text, fontSize: 14, fontWeight: "700" },
  appList: { gap: 8 },
  appListViewport: { maxHeight: 300 },
  appRow: {
    alignItems: "flex-start",
    borderColor: palette.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  appRowSelected: { backgroundColor: palette.panelStrong, borderColor: palette.accent },
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
  capture: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 5,
    padding: 10,
  },
  captureField: { color: palette.text, fontSize: 12, lineHeight: 18 },
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
  localNotice: { color: palette.amber, fontSize: 13, lineHeight: 19 },
  localQueue: {
    borderColor: palette.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  packageName: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  queueCount: { color: palette.accent, fontSize: 11, fontWeight: "800" },
  queueHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  selectorHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  unavailable: { color: palette.amber, fontSize: 11, lineHeight: 16 },
});
