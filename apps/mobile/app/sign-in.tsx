import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppButton, AppText, AppTextInput, StatusMessage } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { reportUnexpectedUiError } from "@/lib/observability";

export default function SignInScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { configurationError, requestMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [statusTone, setStatusTone] = useState<"error" | "info" | "success">(
    reason === "settings" && !configurationError ? "info" : "error",
  );
  const [status, setStatus] = useState(
    configurationError
      ? "Supabase public configuration is unavailable."
      : reason === "invalid-link"
        ? "This sign-in link is invalid or expired. Request a new link."
        : reason === "settings"
          ? "Sign in to manage categories and privacy controls from Settings."
          : "",
  );

  async function submit() {
    const candidate = email.trim();
    if (!candidate.includes("@")) {
      setStatusTone("error");
      setStatus("Enter a valid email address.");
      return;
    }
    setPending(true);
    setStatus("");
    try {
      await requestMagicLink(candidate);
      setStatusTone("success");
      setStatus("Check your email. The link returns only to Relay.");
    } catch (error: unknown) {
      reportUnexpectedUiError(error, "ui.magic_link_request_failed", {
        code: "AUTH_MAGIC_LINK_UI_FAILED",
        integration: "supabase-auth",
        operation: "requestMagicLink",
      });
      setStatusTone("error");
      setStatus("Could not request a sign-in link.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Page
      eyebrow="Private by default"
      title="Sign in to Relay"
      detail="Use an approved Relay account. Relay stores the refreshable session in device-secure storage."
    >
      <Panel title="Email magic link" meta="NO PASSWORD">
        <AppTextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!pending && !configurationError}
          inputMode="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          onSubmitEditing={() => void submit()}
          placeholder="tester@example.com"
          label="Email address"
          textContentType="emailAddress"
          value={email}
        />
        <AppButton
          disabled={pending || configurationError}
          label={pending ? "Requesting..." : "Send sign-in link"}
          loading={pending}
          onPress={() => void submit()}
        />
        {status.length === 0 ? null : <StatusMessage tone={statusTone}>{status}</StatusMessage>}
      </Panel>
      <AppText style={styles.note} tone="muted" variant="caption">
        Account enrollment remains operator controlled.
      </AppText>
    </Page>
  );
}

const styles = StyleSheet.create({
  note: { textAlign: "center" },
});
