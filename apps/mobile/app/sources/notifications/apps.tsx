import { useRouter } from "expo-router";
import { useMemo, useState } from "react";

import { SourceSelectorScreen } from "@/features/device-capture/components/selector/SourceSelectorScreen";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { useSelectableNotificationApps } from "@/features/device-capture/hooks/useSelectableNotificationApps";
import { useTransactionalSelection } from "@/features/device-capture/hooks/useTransactionalSelection";
import {
  isValidNotificationAllowlist,
  normalizeNotificationAppChoices,
} from "@/lib/notification-capture";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

export default function NotificationAppSelectorScreen() {
  const router = useRouter();
  const capture = useDeviceCaptureCapabilities();
  const available = capture.capabilities?.platform === "android";
  const appList = useSelectableNotificationApps(available);
  const savedPackages = capture.capabilities?.notificationAllowedPackages ?? [];
  const selection = useTransactionalSelection(savedPackages);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const launchablePackages = useMemo(
    () => new Set(appList.apps.map((app) => app.packageName)),
    [appList.apps],
  );
  const choices = useMemo(
    () =>
      normalizeNotificationAppChoices([
        ...appList.apps,
        ...savedPackages
          .filter((packageName) => !launchablePackages.has(packageName))
          .map((packageName) => ({ label: packageName, packageName })),
      ]),
    [appList.apps, launchablePackages, savedPackages],
  );
  const items = choices.map((app) => ({
    detail: app.label === app.packageName ? undefined : app.packageName,
    id: app.packageName,
    label: app.label,
    searchText: `${app.label} ${app.packageName}`,
    selected: selection.draft.includes(app.packageName),
    unavailable: !launchablePackages.has(app.packageName),
  }));

  function cancel() {
    selection.cancel();
    router.back();
  }

  async function confirm() {
    if (
      capture.mode.tenantId === undefined ||
      capture.capabilities === undefined ||
      !isValidNotificationAllowlist(selection.draft)
    ) {
      setSaveError("Choose at least one launchable app before saving.");
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      await RelayDeviceIngress.configureNotificationCapture(
        capture.mode.tenantId,
        selection.draft,
        capture.capabilities.notificationCapturePaused,
      );
      selection.confirm();
      router.back();
    } catch {
      setSaveError("Could not save the notification app allowlist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SourceSelectorScreen
      confirmDisabled={!selection.changed || !isValidNotificationAllowlist(selection.draft)}
      confirmLabel="Save apps"
      confirmLoading={saving}
      detail="Choose launchable Android apps. The complete installed-app list stays on this device."
      emptyMessage={
        query.trim().length > 0 ? "No apps match this search." : "No launchable apps are available."
      }
      error={saveError ?? appList.error ?? capture.error}
      items={items}
      loading={capture.capabilities === undefined || appList.loading}
      onBack={cancel}
      onCancel={cancel}
      onConfirm={() => void confirm()}
      onQueryChange={setQuery}
      onRetry={() => void appList.refresh()}
      onToggle={selection.toggle}
      query={query}
      searchLabel="Search apps"
      selectedCount={selection.draft.length}
      title="Manage apps"
    />
  );
}
