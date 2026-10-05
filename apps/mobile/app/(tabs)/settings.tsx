import { router } from "expo-router";
import { useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppText,
  CardGroup,
  CardRow,
  SectionHeading,
  StatusMessage,
} from "@/components/ui";
import { ThemePreferencePanel } from "@/features/settings/components/ThemePreferencePanel";
import { RelayProPanel } from "@/features/subscription/components/RelayProPanel";
import { useAuth } from "@/lib/auth-context";
import { demoModeEnabled } from "@/lib/demo/mode";
import { reportUnexpectedUiError } from "@/lib/observability";

/**
 * How Relay behaves, and the account it behaves for.
 *
 * Everything about what Relay *holds* lives in Your data. Retention, an API key, and account
 * deletion are the controls a person comes to Settings least often and needs most urgently, and
 * putting them below a theme picker made them the easiest things on the screen to scroll past.
 *
 * The screen used to set each control as a numbered stage with a paragraph under it, which read as
 * a document rather than as a set of controls and put the ninth one three scrolls down. Controls
 * are now grouped rows: the band says what the group is for, the row says what the control does,
 * and prose is written only where a setting genuinely needs defending -- which, in a product whose
 * whole argument is consent, is a claim worth being able to make sparingly.
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
      <SectionHeading icon="palette-outline" label="General" />
      <ThemePreferencePanel />

      <SectionHeading icon="database-outline" label="Your data" />
      {configurationError ? (
        <StatusMessage tone="error">
          Relay account services are unavailable in this build.
        </StatusMessage>
      ) : null}
      <CardGroup>
        <CardRow
          accessibilityHint="Opens what Relay holds, where it lives, and how long it is kept"
          detail="What Relay holds, where it lives, and how to take it back."
          icon="archive-outline"
          label="Your data"
          onPress={() => openIfSignedIn("/your-data")}
        />
        <CardRow
          detail="Where captures are filed, and which of them stay quiet."
          icon="shape-outline"
          label={signedIn ? "Categories" : "Sign in to manage categories"}
          onPress={() => openIfSignedIn("/categories")}
        />
      </CardGroup>

      <SectionHeading icon="shield-check-outline" label="Safeguards" />
      <CardGroup>
        <CardRow
          detail="Requires explicit source and filter rules plus dry-run evidence. A quiet category alone never authorizes dismissal, and dismissed system notifications cannot be restored."
          icon="bell-off-outline"
          label="Automatic dismissal"
          status={{ label: "Off", tone: "muted" }}
        />
      </CardGroup>

      {/* A demo build carries no billing SDK, so there is nothing here to show or sell. */}
      {demoModeEnabled() ? (
        <>
          <SectionHeading icon="flask-outline" label="Demo" />
          <CardGroup>
            <CardRow
              detail="A local synthetic account: generate captures, watch rules file them, reset."
              icon="play-circle-outline"
              label="Demo studio"
              onPress={() => router.push("/demo")}
            />
          </CardGroup>
        </>
      ) : (
        <>
          <SectionHeading icon="star-outline" label="Relay Pro" />
          <RelayProPanel />
        </>
      )}

      <SectionHeading icon="account-outline" label="Account" />
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
        <AppButton label="Sign in" onPress={openSignIn} tone="primary" />
      )}
      {signOutError ? (
        <StatusMessage tone="error">Could not clear the local session. Try again.</StatusMessage>
      ) : null}
    </ReceiptScreen>
  );
}
