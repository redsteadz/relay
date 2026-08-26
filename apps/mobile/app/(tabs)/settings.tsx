import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";
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
        <Text style={styles.copy}>
          Encrypted source payloads expire automatically. Derived facts retain provenance without
          full bodies.
        </Text>
      </Panel>
      <Panel title="OpenAI key" meta="NOT CONFIGURED">
        <Text style={styles.copy}>
          Bring-your-own key is encrypted server-side. Relay only invokes it after deterministic
          filters cannot decide.
        </Text>
      </Panel>
      <Panel title="Automatic dismissal" meta="OFF">
        <Text style={styles.copy}>
          Requires explicit source and filter rules plus dry-run evidence. Dismissed system
          notifications cannot be restored.
        </Text>
      </Panel>
      <Panel title="Relay session" meta="SECURESTORE">
        <Text style={styles.copy}>
          Sign out removes the refreshable local session and returns Relay to the identity boundary.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={signingOut}
          onPress={() => void endSession()}
          style={({ pressed }) => [
            styles.signOut,
            signingOut && styles.signOutDisabled,
            pressed && styles.signOutPressed,
          ]}
        >
          <Text style={styles.signOutText}>{signingOut ? "Signing out..." : "Sign out"}</Text>
        </Pressable>
        {signOutError ? (
          <Text style={styles.error}>Could not clear the local session. Try again.</Text>
        ) : null}
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  error: { color: palette.amber, fontSize: 13, lineHeight: 19 },
  signOut: {
    alignSelf: "flex-start",
    borderColor: palette.amber,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  signOutDisabled: { opacity: 0.45 },
  signOutPressed: { opacity: 0.75 },
  signOutText: { color: palette.amber, fontSize: 13, fontWeight: "800" },
});
