import { useRouter } from "expo-router";
import { useState } from "react";

import { AppScreen } from "@/components/AppScreen";
import {
  ActionRow,
  AppButton,
  AppIconButton,
  AppText,
  ContextualNotice,
  EditorialSurface,
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
      backLabel="Back to Sources"
      detail="Restricted-scope mailbox events with minimized delivery."
      onBack={() => router.back()}
      title="Gmail"
      titleAccessory={
        <ActionRow compact wrap={false}>
          <AppIconButton
            accessibilityHint="Explains Gmail privacy boundaries"
            accessibilityLabel="Gmail privacy information"
            compact
            icon="information-outline"
            onPress={() => setDisclosureVisible(true)}
          />
          <AppIconButton
            accessibilityHint="Opens Gmail source controls"
            accessibilityLabel="Gmail settings"
            compact
            icon="cog-outline"
            onPress={() => setSettingsVisible(true)}
          />
        </ActionRow>
      }
    >
      <SourceStatusLabel status={gmailStatus} />
      <EditorialSurface
        icon="shield-lock-outline"
        title="Restricted-scope design"
        titleAccessory={
          <ContextualNotice accessibilityLabel="Gmail connection availability">
            Gmail connection is coming later. No mailbox permission is requested in this build.
          </ContextualNotice>
        }
      >
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
