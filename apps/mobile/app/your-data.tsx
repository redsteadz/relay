import { useRouter } from "expo-router";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { AppButton, AppText, EditorialSurface } from "@/components/ui";
import { DataHoldingsTable } from "@/features/privacy/components/DataHoldingsTable";
import { PrivacySettings } from "@/features/privacy/components/PrivacySettings";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";
import { useAuth } from "@/lib/auth-context";

/**
 * Everything Relay holds about this account, and every control over it.
 *
 * Split out of Settings because the two answer different questions. Settings is where a person
 * changes how Relay behaves; this is where they find out what it has and take it back. Mixing
 * retention, an API key, and account deletion in among a theme picker made the controls that matter
 * most the ones easiest to scroll past.
 *
 * The table at the top is a statement about the architecture rather than a read of the account. The
 * panels below it are the account: what is actually retained, and the controls that change it.
 */
export default function YourDataScreen() {
  const router = useRouter();
  const { clearDeletedAccountSession, configurationError, session } = useAuth();

  return (
    <ReceiptScreen onBack={() => router.back()} title="Your data">
      <ReceiptStage label="Where it lives" ordinal={1}>
        <AppText tone="muted" variant="caption">
          The same for every account. This is how Relay is built, not a reading of what you have.
        </AppText>
        <DataHoldingsTable />
      </ReceiptStage>

      <ReceiptStage label="What is retained now" ordinal={2}>
        <PrivacySettings
          accessToken={session?.access_token}
          clearDeletedAccountSession={clearDeletedAccountSession}
          configurationError={configurationError}
          onSignIn={() => router.push({ params: { reason: "settings" }, pathname: "/sign-in" })}
          userId={session?.user.id}
        />
      </ReceiptStage>

      <ReceiptStage label="What left the account" ordinal={3}>
        <EditorialSurface icon="file-eye-outline" meta="Metadata only" title="Disclosure history">
          <AppText tone="muted">
            Provider, model, disclosed field names, purpose, and time. Prompts and source content
            are never recorded.
          </AppText>
          <AppButton
            label="View disclosure history"
            onPress={() => router.push("/disclosures")}
            tone="secondary"
          />
        </EditorialSurface>
      </ReceiptStage>
    </ReceiptScreen>
  );
}
