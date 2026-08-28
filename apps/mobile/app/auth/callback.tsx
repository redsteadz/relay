import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppText } from "@/components/ui";
import { validCallbackCode } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

export default function AuthCallbackScreen() {
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const router = useRouter();
  const { completeMagicLink, configurationError } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const callbackCode = validCallbackCode(code);
    if (configurationError || callbackCode === undefined) {
      router.replace({ pathname: "/sign-in", params: { reason: "invalid-link" } });
      return;
    }
    void completeMagicLink(callbackCode).catch(() => {
      router.replace({ pathname: "/sign-in", params: { reason: "invalid-link" } });
    });
  }, [code, completeMagicLink, configurationError, router]);

  return (
    <Page
      eyebrow="Identity boundary"
      title="Signing in"
      detail="Relay exchanges this one-time callback without logging or retaining its code."
    >
      <Panel title="Magic-link exchange" meta="ONE TIME">
        <AppText accessibilityLiveRegion="polite" tone="muted">
          Completing secure sign-in...
        </AppText>
      </Panel>
    </Page>
  );
}
