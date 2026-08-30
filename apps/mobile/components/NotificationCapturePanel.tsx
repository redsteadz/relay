import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";

import {
  filterNotificationAppChoices,
  isValidNotificationAllowlist,
  normalizeNotificationAppChoices,
  toggleNotificationAppSelection,
} from "@/lib/notification-capture";
import { useLocalCapturePreviews } from "@/hooks/useLocalCapturePreviews";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress, {
  type DeviceCapabilities,
  type NotificationCapturePreview,
  type SelectableNotificationApp,
} from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

import { LocalCaptureQueue } from "./LocalCaptureQueue";
import { Panel } from "./Panel";
import { AppButton, AppCheckbox, AppSwitch, AppText, AppTextInput, StatusMessage } from "./ui";

type Props = {
  capabilities: DeviceCapabilities | undefined;
  developmentLocal: boolean;
  localPreviewEnabled: boolean;
  localPreviewError: string | undefined;
  tenantId: string | undefined;
  onChanged: () => Promise<void>;
};

export function NotificationCapturePanel({
  capabilities,
  developmentLocal,
  localPreviewEnabled,
  localPreviewError,
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
        } catch (error: unknown) {
          logMobileError("capture.notification_apps_load_failed", error, {
            code: "NOTIFICATION_APPS_LOAD_FAILED",
            integration: "relay-device-ingress",
            operation: "getSelectableNotificationApps",
          });
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
  const loadLocalCaptures = useCallback(
    () =>
      tenantId === undefined
        ? Promise.resolve<NotificationCapturePreview[]>([])
        : RelayDeviceIngress.getNotificationCapturePreviews(tenantId),
    [tenantId],
  );
  const localPreview = useLocalCapturePreviews({
    enabled: localPreviewEnabled && developmentLocal && tenantId !== undefined,
    errorMessage: "Could not read the encrypted native queue.",
    load: loadLocalCaptures,
  });

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
    } catch (error: unknown) {
      logMobileError("capture.notification_access_open_failed", error, {
        code: "NOTIFICATION_ACCESS_OPEN_FAILED",
        integration: "relay-device-ingress",
        operation: "openNotificationAccessSettings",
      });
      setStatus("Could not save notification controls.");
    }
  }

  async function saveControls() {
    setStatus(undefined);
    try {
      if (!(await save(paused))) setStatus("Add a valid app package before saving controls.");
      else setStatus("Notification controls saved.");
    } catch (error: unknown) {
      logMobileError("capture.notification_controls_save_failed", error, {
        code: "NOTIFICATION_CONTROLS_SAVE_FAILED",
        integration: "relay-device-ingress",
        operation: "saveNotificationControls",
      });
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
    } catch (error: unknown) {
      logMobileError("capture.notification_state_update_failed", error, {
        code: "NOTIFICATION_CAPTURE_STATE_FAILED",
        integration: "relay-device-ingress",
        operation: "setNotificationCapturePaused",
      });
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
        <LocalCaptureQueue
          captures={localPreview.captures}
          description="Development-local diagnostic. Relay decrypts these minimized fields only while this panel is visible. Nothing is copied to logs, app storage, or network."
          emptyMessage="No pending notification captures reached the queue yet."
          error={localPreviewError ?? localPreview.error}
          fields={(capture) => [
            { label: "Sender", value: capture.sender },
            { label: "Subject", value: capture.subject },
            { label: "Body", value: capture.body },
            { label: "Application ID", value: capture.applicationId },
            { label: "Captured at", value: capture.capturedAt },
          ]}
          keyFor={(capture, index) =>
            `${capture.capturedAt}-${capture.applicationId ?? "unknown"}-${index.toString()}`
          }
          onRefresh={localPreview.refresh}
          refreshLabel="Refresh pending captures"
          refreshing={localPreview.refreshing}
          title="Encrypted notification queue"
        />
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
  selectorHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
});
