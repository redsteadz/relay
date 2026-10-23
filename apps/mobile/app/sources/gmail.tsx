import { useRouter } from "expo-router";
import { useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { AppButton, AppIconButton, AppText, ContextualNotice } from "@/components/ui";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceStatusLabel } from "@/features/device-capture/components/source/SourceStatusLabel";
import { gmailStatus } from "@/features/device-capture/models/capturePresentation";
import { gmailDisclosure } from "@/features/device-capture/models/sourceCatalog";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";

/** Gmail privacy disclosure and entry into the shared Google connection settings. */
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
          Google Pub/Sub delivers mailbox cursors to Relay, not message bodies. The connection flow
          requests Gmail read access only when you connect this source.
        </AppText>
        <ContextualNotice accessibilityLabel="Gmail connection availability">
          Connect and manage Gmail from Smart Automations. Google permissions are requested in your
          browser and credentials stay on the backend.
        </ContextualNotice>
        <AppButton
          label="Manage Gmail connection"
          onPress={() => router.push("/smart-automations")}
        />
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
