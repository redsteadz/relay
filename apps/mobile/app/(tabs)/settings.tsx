import { router, type Href } from "expo-router";
import { useState } from "react";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppButton, AppText, StatusMessage } from "@/components/ui";
import { PrivacySettings } from "@/features/privacy/components/PrivacySettings";
import { useAuth } from "@/lib/auth-context";

export default function SettingsScreen() {
  const { clearDeletedAccountSession, session, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  async function endSession() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      await signOut();
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Page
      eyebrow="Local control"
      title="Settings"
      detail="Retention, AI disclosure, and irreversible actions stay visible and conservative."
    >
      <Panel title="Categories" meta="CUSTOM + SYSTEM">
        <AppText tone="muted">
          Create, reorder, quiet, and archive tenant-owned categories while stable system slugs stay
          protected.
        </AppText>
        <AppButton
          disabled={session === null}
          label="Manage categories"
          onPress={() => router.push("/categories" as Href)}
          tone="secondary"
        />
      </Panel>
      <PrivacySettings
        accessToken={session?.access_token}
        clearDeletedAccountSession={clearDeletedAccountSession}
        userId={session?.user.id}
      />
      <Panel title="Automatic dismissal" meta="OFF">
        <AppText tone="muted">
          Requires explicit source and filter rules plus dry-run evidence. A quiet category alone
          never authorizes dismissal, and dismissed system notifications cannot be restored.
        </AppText>
      </Panel>
      <Panel title="Relay session" meta="SECURESTORE">
        <AppText tone="muted">
          Sign out removes the refreshable local session and returns Relay to the identity boundary.
        </AppText>
        <AppButton
          label={signingOut ? "Signing out..." : "Sign out"}
          loading={signingOut}
          onPress={() => void endSession()}
          tone="destructive"
        />
        {signOutError ? (
          <StatusMessage tone="error">Could not clear the local session. Try again.</StatusMessage>
        ) : null}
      </Panel>
    </Page>
  );
}
