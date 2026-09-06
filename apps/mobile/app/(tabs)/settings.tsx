import { router } from "expo-router";
import { useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { AppButton, AppText, EditorialSurface, StatusMessage } from "@/components/ui";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";
import { ThemePreferencePanel } from "@/features/settings/components/ThemePreferencePanel";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";

/**
 * How Relay behaves, and the account it behaves for.
 *
 * Everything about what Relay *holds* moved to Your data. Retention, an API key, and account
 * deletion were the controls a person comes to Settings least often and needs most urgently, and
 * putting them below a theme picker made them the easiest things on the screen to scroll past.
 */
export default function SettingsScreen() {
  const { configurationError, session, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const signedIn = session !== null;

  function openSignIn() {
    router.push({ params: { reason: "settings" }, pathname: "/sign-in" });
  }

  function openIfSignedIn(pathname: "/categories" | "/your-data") {
    if (!signedIn && pathname === "/categories") {
      openSignIn();
      return;
    }
    router.push(pathname);
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
    <ReceiptScreen title="Settings">
      <ReceiptStage label="Appearance" ordinal={1}>
        <ThemePreferencePanel />
      </ReceiptStage>

      <ReceiptStage label="Your data" ordinal={2}>
        <AppText tone="muted" variant="caption">
          What Relay holds, where it lives, how long it is kept, and how to take it back.
        </AppText>
        {configurationError ? (
          <StatusMessage tone="error">
            Relay account services are unavailable in this build.
          </StatusMessage>
        ) : null}
        <AppButton
          label="Open your data"
          onPress={() => openIfSignedIn("/your-data")}
          tone="secondary"
        />
        <AppButton
          label={signedIn ? "Manage categories" : "Sign in to manage categories"}
          onPress={() => openIfSignedIn("/categories")}
          tone="secondary"
        />
      </ReceiptStage>

      <ReceiptStage label="Safeguards" ordinal={3}>
        <EditorialSurface icon="bell-off-outline" meta="Off" title="Automatic dismissal">
          <AppText tone="muted">
            Requires explicit source and filter rules plus dry-run evidence. A quiet category alone
            never authorizes dismissal, and dismissed system notifications cannot be restored.
          </AppText>
        </EditorialSurface>
      </ReceiptStage>

      <ReceiptStage label="Account" ordinal={4}>
        <AppText tone="muted" variant="caption">
          {signedIn
            ? "Signing out removes the refreshable session from secure device storage. Nothing on the server is deleted."
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
      </ReceiptStage>
    </ReceiptScreen>
  );
}
