import { useState } from "react";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppButton, AppText, StatusMessage } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

export default function SettingsScreen() {
  const { signOut } = useAuth();
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
      <Panel title="Raw data retention" meta="7 DAYS">
        <AppText tone="muted">
          Encrypted source payloads expire automatically. Derived facts retain provenance without
          full bodies.
        </AppText>
      </Panel>
      <Panel title="OpenAI key" meta="NOT CONFIGURED">
        <AppText tone="muted">
          Bring-your-own key is encrypted server-side. Relay only invokes it after deterministic
          filters cannot decide.
        </AppText>
      </Panel>
      <Panel title="Automatic dismissal" meta="OFF">
        <AppText tone="muted">
          Requires explicit source and filter rules plus dry-run evidence. Dismissed system
          notifications cannot be restored.
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
