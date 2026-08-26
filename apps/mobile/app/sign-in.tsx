import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";

import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { useAuth } from "@/lib/auth-context";

export default function SignInScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { configurationError, requestMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(
    reason === "invalid-link"
      ? "This sign-in link is invalid or expired. Request a new link."
      : configurationError
        ? "Supabase public configuration is unavailable."
        : "",
  );

  async function submit() {
    const candidate = email.trim();
    if (!candidate.includes("@")) {
      setStatus("Enter a valid email address.");
      return;
    }
    setPending(true);
    setStatus("");
    try {
      await requestMagicLink(candidate);
      setStatus("Check your email. The link returns only to Relay.");
    } catch {
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
        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!pending && !configurationError}
          inputMode="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          onSubmitEditing={() => void submit()}
          placeholder="tester@example.com"
          placeholderTextColor={palette.muted}
          style={styles.input}
          textContentType="emailAddress"
          value={email}
        />
        <Pressable
          accessibilityRole="button"
          disabled={pending || configurationError}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.button,
            (pending || configurationError) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.buttonText}>{pending ? "Requesting..." : "Send sign-in link"}</Text>
        </Pressable>
        {status.length === 0 ? null : <Text style={styles.status}>{status}</Text>}
      </Panel>
      <Text style={styles.note}>Account enrollment remains operator controlled.</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: palette.background, fontSize: 14, fontWeight: "800" },
  input: {
    backgroundColor: palette.panelStrong,
    borderColor: palette.border,
    borderRadius: 10,
    borderWidth: 1,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  note: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  status: { color: palette.amber, fontSize: 13, lineHeight: 19 },
});
