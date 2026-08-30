import { router } from "expo-router";
import { useState } from "react";

import { AppScreen } from "@/components/AppScreen";
import { AppButton, AppText, EditorialSurface, StatusMessage } from "@/components/ui";
import { PrivacySettings } from "@/features/privacy/components/PrivacySettings";
import { ThemePreferencePanel } from "@/features/settings/components/ThemePreferencePanel";
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
    <AppScreen
      eyebrow="Local control"
      title="Settings"
      detail="Retention, AI disclosure, and irreversible actions stay visible and conservative."
    >
      <ThemePreferencePanel />
      <EditorialSurface icon="shape-outline" title="Categories" meta="Custom + system">
        <AppText tone="muted">
          Create, reorder, quiet, and archive tenant-owned categories while stable system slugs stay
          protected.
        </AppText>
        <AppButton
          disabled={session === null}
          label="Manage categories"
          onPress={() => router.push("/categories")}
          tone="secondary"
        />
      </EditorialSurface>
      <PrivacySettings
        accessToken={session?.access_token}
        clearDeletedAccountSession={clearDeletedAccountSession}
        userId={session?.user.id}
      />
      <EditorialSurface icon="bell-off-outline" title="Automatic dismissal" meta="Off">
        <AppText tone="muted">
          Requires explicit source and filter rules plus dry-run evidence. A quiet category alone
          never authorizes dismissal, and dismissed system notifications cannot be restored.
        </AppText>
      </EditorialSurface>
      <EditorialSurface icon="lock-outline" title="Relay session" meta="Secure device storage">
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
      </EditorialSurface>
    </AppScreen>
  );
}
