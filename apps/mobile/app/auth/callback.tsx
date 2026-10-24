import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { AppButton, AppText, EditorialSurface } from "@/components/ui";
import { validCallbackCode } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

const SLOW_EXCHANGE_MS = 15_000;

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

  // A link exchange that never settles would otherwise leave the reader on this screen with no way
  // forward. The exchange itself keeps running; this only offers a route out.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_EXCHANGE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ReceiptScreen title="Signing in">
      <EditorialSurface
        icon="shield-key-outline"
        title="Checking your sign-in link"
        meta="One time"
        variant="raised"
      >
        <AppText accessibilityLiveRegion="polite" tone="muted">
          {slow
            ? "This is taking longer than usual. Your connection may be slow, or the link may have expired."
            : "Signing you in securely..."}
        </AppText>
        {slow ? (
          <AppButton
            label="Send a new link"
            onPress={() => router.replace({ pathname: "/sign-in" })}
            tone="secondary"
          />
        ) : null}
      </EditorialSurface>
    </ReceiptScreen>
  );
}
