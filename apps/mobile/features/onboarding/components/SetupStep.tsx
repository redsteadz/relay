import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton, AppDialog, AppText, StatusMessage } from "@/components/ui";
import { useBackgroundDelivery } from "@/features/device-capture/hooks/useBackgroundDelivery";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { notificationDisclosure } from "@/features/device-capture/models/sourceCatalog";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

import {
  backgroundPermission,
  continueLabel,
  notificationPermission,
  setupComplete,
  visibleRows,
  type PermissionId,
} from "../models/setupPresentation";
import { PermissionCard } from "./PermissionCard";

/**
 * Permissions, first and together.
 *
 * Relay used to ask for nothing here and leave every grant to be discovered later under Sources.
 * Now the system access Relay needs is the first thing set up, on one screen, one row each. Android
 * owns the actual grant, so returning from its settings refreshes the rows on their own.
 *
 * Continuing waits on notification access, the one permission without which Relay reads nothing.
 * Skipping stays available: a setup that cannot be left is a wall, and every row here is also in
 * Sources for later.
 */
export function SetupStep({ onFinish }: { onFinish: () => void }) {
  const theme = useRelayTheme();
  const { colors, layout, spacing } = theme.relay;
  const capture = useDeviceCaptureCapabilities();
  const delivery = useBackgroundDelivery();
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [disclosureVisible, setDisclosureVisible] = useState(false);

  const notifications = notificationPermission(capture.capabilities, capture.error !== undefined);
  const rows = visibleRows([notifications, backgroundPermission(delivery)]);
  const complete = setupComplete(notifications);

  async function allowNotifications() {
    setOpening(true);
    setOpenFailed(false);
    try {
      await RelayDeviceIngress.openNotificationAccessSettings();
    } catch (error: unknown) {
      logMobileError("capture.notification_access_open_failed", error, {
        code: "NOTIFICATION_ACCESS_OPEN_FAILED",
        integration: "relay-device-ingress",
        operation: "openNotificationAccessSettings",
      });
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }

  const allow: Record<PermissionId, () => void> = {
    background: () => void delivery.setEnabled(true),
    notifications: () => void allowNotifications(),
  };
  const busy: Record<PermissionId, boolean> = { background: delivery.busy, notifications: opening };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { gap: spacing.lg, padding: layout.compactGutter, paddingTop: spacing.xxl },
        ]}
      >
        <View style={{ gap: spacing.sm }}>
          <AppText accessibilityRole="header" variant="display">
            Set up Relay
          </AppText>
          <AppText tone="muted">Allow these and Relay starts sorting.</AppText>
        </View>

        {rows.map((row) => (
          <PermissionCard busy={busy[row.id]} key={row.id} onAllow={allow[row.id]} row={row} />
        ))}

        {notifications.state === "unavailable" ? (
          <AppText tone="muted" variant="caption">
            Capture needs an Android phone. You can still sign in and look around.
          </AppText>
        ) : null}

        {capture.error === undefined ? null : (
          <StatusMessage tone="error">{capture.error}</StatusMessage>
        )}
        {openFailed ? (
          <StatusMessage tone="error">
            Could not open Android settings. Try again, or allow Relay under notification access in
            your phone&apos;s settings.
          </StatusMessage>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.foot,
          { gap: spacing.md, padding: layout.compactGutter, paddingBottom: spacing.xl },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          hitSlop={spacing.sm}
          onPress={() => setDisclosureVisible(true)}
          style={styles.centered}
        >
          <AppText tone="accent" variant="caption">
            How Relay handles your data
          </AppText>
        </Pressable>

        <AppButton disabled={!complete} label={continueLabel(notifications)} onPress={onFinish} />

        {complete ? null : (
          <Pressable
            accessibilityRole="button"
            hitSlop={spacing.sm}
            onPress={onFinish}
            style={styles.centered}
          >
            <AppText tone="muted" variant="caption">
              Skip for now
            </AppText>
          </Pressable>
        )}
      </View>

      <AppDialog
        actions={<AppButton label="Done" onPress={() => setDisclosureVisible(false)} />}
        icon="shield-check-outline"
        onDismiss={() => setDisclosureVisible(false)}
        title="Your data"
        visible={disclosureVisible}
      >
        <AppText>{notificationDisclosure(capture.mode.developmentLocal)}</AppText>
      </AppDialog>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", width: "100%" },
  content: { width: "100%" },
  foot: { width: "100%" },
  safeArea: { flex: 1 },
});
