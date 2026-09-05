import { useRouter } from "expo-router";
import { useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { AppButton, AppIconButton, AppText, ContextualNotice } from "@/components/ui";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceStatusLabel } from "@/features/device-capture/components/source/SourceStatusLabel";
import { gmailStatus } from "@/features/device-capture/models/capturePresentation";
import { gmailDisclosure } from "@/features/device-capture/models/sourceCatalog";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";

/**
 * The Gmail source boundary.
 *
 * The settings control is gone rather than opening an empty dialog: there are no Gmail controls
 * until the restricted-scope connection ships, and a gear that leads nowhere is worse than no gear.
 * What the scope will be is stated here instead, because that is the part a person can act on now.
 */
export default function GmailSourceScreen() {
  const router = useRouter();
  const [disclosureVisible, setDisclosureVisible] = useState(false);

  return (
    <ReceiptScreen
      action={
        <AppIconButton
          accessibilityHint="Explains Gmail privacy boundaries"
          accessibilityLabel="Gmail privacy information"
          icon="information-outline"
          onPress={() => setDisclosureVisible(true)}
        />
      }
      onBack={() => router.back()}
      title="Gmail"
    >
      <SourceStatusLabel status={gmailStatus} />

      <ReceiptStage label="Restricted-scope design" ordinal={1}>
        <AppText>
          Google Pub/Sub delivers mailbox cursors to Relay, not message bodies. A future connection
          flow will show the exact requested scope before authorization.
        </AppText>
        <ContextualNotice accessibilityLabel="Gmail connection availability">
          Gmail connection is coming later. No mailbox permission is requested in this build.
        </ContextualNotice>
        <AppButton disabled label="Connect Gmail" onPress={() => undefined} />
      </ReceiptStage>

      <SourceDisclosureDialog
        disclosure={gmailDisclosure}
        onDismiss={() => setDisclosureVisible(false)}
        sourceName="Gmail"
        visible={disclosureVisible}
      />
    </ReceiptScreen>
  );
}
