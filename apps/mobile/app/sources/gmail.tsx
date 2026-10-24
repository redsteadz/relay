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

      <ReceiptStage label="How Gmail will work" ordinal={1}>
        <AppText>
          Gmail will tell Relay that new mail arrived, not what it says. Before you connect, Relay
          will show exactly what it asks Google for.
        </AppText>
        <ContextualNotice accessibilityLabel="Gmail connection availability">
          Gmail is not available yet, and Relay asks for no mailbox access. Notifications capture
          works today and covers mail apps on this device.
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
