import { useRouter } from "expo-router";
import { useState } from "react";

import { AppScreen } from "@/components/AppScreen";
import {
  AppButton,
  AppIconButton,
  AppText,
  EditorialSurface,
  StatusMessage,
} from "@/components/ui";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceSettingsDialog } from "@/features/device-capture/components/source/SourceSettingsDialog";
import { SourceStatusLabel } from "@/features/device-capture/components/source/SourceStatusLabel";
import { gmailStatus } from "@/features/device-capture/models/capturePresentation";
import { gmailDisclosure } from "@/features/device-capture/models/sourceCatalog";

export default function GmailSourceScreen() {
  const router = useRouter();
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  return (
    <AppScreen
      action={
        <AppIconButton
          accessibilityHint="Opens Gmail source controls"
          accessibilityLabel="Gmail settings"
          icon="cog-outline"
          onPress={() => setSettingsVisible(true)}
        />
      }
      backLabel="Back to Sources"
      detail="Restricted-scope mailbox events with minimized delivery."
      onBack={() => router.back()}
      title="Gmail"
      titleAccessory={
        <AppIconButton
          accessibilityHint="Explains Gmail privacy boundaries"
          accessibilityLabel="Gmail privacy information"
          icon="information-outline"
          onPress={() => setDisclosureVisible(true)}
        />
      }
    >
      <SourceStatusLabel status={gmailStatus} />
      <StatusMessage tone="info">
        Gmail connection is coming later. No mailbox permission is requested in this build.
      </StatusMessage>
      <EditorialSurface icon="shield-lock-outline" title="Restricted-scope design">
        <AppText>
          Google Pub/Sub delivers mailbox cursors to Relay, not message bodies. A future connection
          flow will show the exact requested scope before authorization.
        </AppText>
        <AppButton disabled label="Connect Gmail" onPress={() => undefined} />
      </EditorialSurface>
      <SourceDisclosureDialog
        disclosure={gmailDisclosure}
        onDismiss={() => setDisclosureVisible(false)}
        sourceName="Gmail"
        visible={disclosureVisible}
      />
      <SourceSettingsDialog
        actions={[]}
        detail="No Gmail controls are available until the restricted-scope connection ships."
        onDismiss={() => setSettingsVisible(false)}
        sourceName="Gmail"
        visible={settingsVisible}
      />
    </AppScreen>
  );
}
