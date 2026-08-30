import { router } from "expo-router";
import { useState } from "react";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppButton, AppText, StatusMessage } from "@/components/ui";
import { PrivacySettings } from "@/features/privacy/components/PrivacySettings";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";

export default function SettingsScreen() {
  const { clearDeletedAccountSession, configurationError, session, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const signedIn = session !== null;

  function openSignIn() {
    router.push({ pathname: "/sign-in", params: { reason: "settings" } });
  }

  function openCategories() {
    if (!signedIn) {
      openSignIn();
      return;
    }
    router.push("/categories");
  }

  async function endSession() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      await signOut();
    } catch (error: unknown) {
      reportUnexpectedUiError(error, "ui.sign_out_failed", {
        code: "AUTH_SIGN_OUT_UI_FAILED",
        integration: "supabase-auth",
        operation: "signOut",
      });
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Page
      eyebrow="Local control"
      title="Settings"
      detail="Manage categories, privacy, automation safeguards, and your Relay account."
    >
      <Panel title="Categories" meta={signedIn ? "CUSTOM + SYSTEM" : "AUTHENTICATION NEEDED"}>
        <AppText tone="muted">
          Create, reorder, quiet, and archive tenant-owned categories while stable system slugs stay
          protected.
        </AppText>
        {configurationError ? (
          <StatusMessage tone="error">
            Relay account services are unavailable in this build.
          </StatusMessage>
        ) : null}
        <AppButton
          label={signedIn ? "Open category manager" : "Sign in to manage categories"}
          onPress={openCategories}
          tone="secondary"
        />
      </Panel>
      <PrivacySettings
        accessToken={session?.access_token}
        clearDeletedAccountSession={clearDeletedAccountSession}
        configurationError={configurationError}
        onSignIn={openSignIn}
        userId={session?.user.id}
      />
      <Panel title="Automatic dismissal" meta="OFF">
        <AppText tone="muted">
          Requires explicit source and filter rules plus dry-run evidence. A quiet category alone
          never authorizes dismissal, and dismissed system notifications cannot be restored.
        </AppText>
      </Panel>
      <Panel title="Relay account" meta={signedIn ? "SIGNED IN" : "SIGNED OUT"}>
        <AppText tone="muted">
          {signedIn
            ? "Signing out removes the refreshable session from secure device storage."
            : "Sign in to manage account-backed categories and privacy controls."}
        </AppText>
        {signedIn ? (
          <AppButton
            label={signingOut ? "Signing out..." : "Sign out"}
            loading={signingOut}
            onPress={() => void endSession()}
            tone="destructive"
          />
        ) : (
          <AppButton label="Sign in" onPress={openSignIn} tone="secondary" />
        )}
        {signOutError ? (
          <StatusMessage tone="error">Could not clear the local session. Try again.</StatusMessage>
        ) : null}
      </Panel>
    </Page>
  );
}
