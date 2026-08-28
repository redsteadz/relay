import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";

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
import { useRelayTheme } from "@/theme";

import { Panel } from "./Panel";
import { AppButton, AppCheckbox, AppSwitch, AppText, AppTextInput, StatusMessage } from "./ui";

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
  const theme = useRelayTheme();
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
      <AppText>
        Relay can read the title and visible text of notifications from only the apps you list. It
        {developmentLocal
          ? " encrypts them in a separate on-device queue and does not upload them."
          : " encrypts them on this device and uploads them to your Relay account."}{" "}
        Raw payloads are deleted after seven days. Relay never uploads the full extras bundle and
        cannot dismiss notifications.
      </AppText>
      {developmentLocal ? (
        <StatusMessage tone="warning">
          Development-only local mode. Local captures are deleted before authenticated sync starts;
          save these controls again after authentication to enable uploads.
        </StatusMessage>
      ) : null}
      <View style={styles.selectorHeading}>
        <AppText variant="label">Apps Relay may capture</AppText>
        <AppText tone="accent" variant="eyebrow">
          {allowedPackages.length} SELECTED
        </AppText>
      </View>
      <AppText tone="muted">
        Choose from launchable Android apps. Installed app labels and the full app list stay on this
        device and are never logged or uploaded.
      </AppText>
      <AppText tone="muted">
        {developmentLocal
          ? "Selected package IDs remain in local capture configuration."
          : "Each selected package ID is attached to its authenticated capture as provenance and uploaded with that capture."}
      </AppText>
      <AppTextInput
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search launchable Android apps"
        label="Search apps"
        onChangeText={setAppSearch}
        placeholder="Search app name or package"
        value={appSearch}
      />
      <ScrollView nestedScrollEnabled style={styles.appListViewport}>
        <View accessibilityRole="list" style={styles.appList}>
          {appListLoading ? <AppText tone="muted">Loading launchable apps...</AppText> : null}
          {!appListLoading && filteredAppChoices.length === 0 ? (
            <AppText tone="muted">
              {appSearch.trim().length > 0
                ? "No launchable apps match this search."
                : "No launchable Android apps available."}
            </AppText>
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
                style={({ pressed }) => [
                  styles.appRow,
                  {
                    backgroundColor: selected
                      ? theme.relay.colors.accentSubtle
                      : theme.relay.colors.surface,
                    borderColor: selected ? theme.relay.colors.accent : theme.relay.colors.border,
                    borderRadius: theme.relay.radii.md,
                    opacity: pressed ? theme.relay.interaction.pressedOpacity : 1,
                  },
                ]}
              >
                <AppText tone="accent" variant="heading">
                  {selected ? "[x]" : "[ ]"}
                </AppText>
                <View style={styles.appCopy}>
                  <AppText variant="label">{app.label}</AppText>
                  {app.label === app.packageName ? null : (
                    <AppText tone="muted" variant="caption">
                      {app.packageName}
                    </AppText>
                  )}
                  {unavailable ? (
                    <AppText tone="warning" variant="caption">
                      Saved selection - not currently launchable
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      {appListStatus === undefined ? null : (
        <StatusMessage tone="error">{appListStatus}</StatusMessage>
      )}
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
      {!isValidNotificationAllowlist(allowedPackages) ? (
        <StatusMessage tone="error">Choose at least one app before saving controls.</StatusMessage>
      ) : null}
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
      {developmentLocal ? (
        <View
          style={[
            styles.localQueue,
            {
              borderColor: theme.relay.colors.border,
              borderRadius: theme.relay.radii.md,
            },
          ]}
        >
          <View style={styles.queueHeading}>
            <AppText variant="label">Encrypted native queue</AppText>
            <AppText tone="accent" variant="eyebrow">
              {localCaptures.length} PENDING
            </AppText>
          </View>
          <AppText tone="muted">
            Development-local diagnostic. Relay decrypts these minimized fields only while this
            panel is visible. Nothing is copied to logs, app storage, or network.
          </AppText>
          <AppButton
            disabled={localQueueRefreshing}
            label={localQueueRefreshing ? "Refreshing..." : "Refresh pending captures"}
            onPress={() => void refreshLocalCaptures()}
            tone="secondary"
          />
          {localQueueStatus === undefined ? null : (
            <StatusMessage tone="error">{localQueueStatus}</StatusMessage>
          )}
          {!localQueueRefreshing && localCaptures.length === 0 ? (
            <AppText tone="muted">No pending notification captures reached the queue yet.</AppText>
          ) : null}
          {localCaptures.map((capture, index) => (
            <View
              key={`${capture.capturedAt}-${capture.applicationId ?? "unknown"}-${index.toString()}`}
              style={[
                styles.capture,
                {
                  backgroundColor: theme.relay.colors.background,
                  borderColor: theme.relay.colors.border,
                  borderRadius: theme.relay.radii.md,
                },
              ]}
            >
              <AppText variant="caption">Sender: {capture.sender ?? "Not available"}</AppText>
              <AppText variant="caption">Subject: {capture.subject ?? "Not available"}</AppText>
              <AppText variant="caption">Body: {capture.body ?? "Not available"}</AppText>
              <AppText variant="caption">
                Application ID: {capture.applicationId ?? "Not available"}
              </AppText>
              <AppText variant="caption">Captured at: {capture.capturedAt}</AppText>
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
  appList: { gap: 8 },
  appListViewport: { maxHeight: 300 },
  appRow: {
    alignItems: "flex-start",
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  capture: {
    borderWidth: 1,
    gap: 5,
    padding: 10,
  },
  localQueue: {
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
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
});
