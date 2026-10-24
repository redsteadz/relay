import "react-native-gesture-handler";

import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono/600SemiBold";
import { SpaceGrotesk_600SemiBold } from "@expo-google-fonts/space-grotesk/600SemiBold";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk/700Bold";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppButton, FeedbackState, LoadingState } from "@/components/ui";
import { resolvePendingSilencesForTenant } from "@/features/silence/api/silenceResolution";
import { SubscriptionProvider } from "@/features/subscription/context/subscription-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { prepareCaptureTenant } from "@/lib/capture-preparation";
import { serializeCaptureWork } from "@/lib/capture-work";
import { clearLocalStoreForTenant } from "@/lib/local-store";
import { clearDeviceSemanticConfig } from "@/lib/device-semantic-config";
import { demoModeEnabled } from "@/lib/demo/mode";
import {
  restoreBackgroundSyncRegistration,
  setBackgroundSyncEnabled,
} from "@/lib/background-capture-sync";
import {
  canEnterApp,
  canEnterSignIn,
  localDevelopmentAccessEnabled,
  localDiagnosticsDisabled,
  notificationCaptureMode,
} from "@/lib/development-access";
import { syncDeviceCaptures } from "@/lib/device-capture-sync";
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding-context";
import { logMobileError, runInBackground } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { RelayThemeProvider, useRelayTheme } from "@/theme";

runInBackground(SplashScreen.preventAutoHideAsync(), "ui.splash_prevent_auto_hide_failed", {
  code: "SPLASH_PREVENT_AUTO_HIDE_FAILED",
  integration: "expo-splash-screen",
  operation: "preventAutoHideAsync",
});

function AuthenticatedStack() {
  const { initialized, session } = useAuth();
  const queryClient = useQueryClient();
  const onboarding = useOnboarding();
  const localDevelopmentAccess = localDevelopmentAccessEnabled(
    __DEV__,
    Constants.expoConfig?.extra?.relayBuildVariant,
    localDiagnosticsDisabled(),
  );
  const captureMode = notificationCaptureMode(
    session?.user.id,
    localDevelopmentAccess,
    Platform.OS,
  );
  const [preparedStateKey, setPreparedStateKey] = useState<string>();
  const [preparationFailed, setPreparationFailed] = useState(false);
  // Bumped by Retry so the preparation effect runs again without asking the reader to restart.
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const previousCaptureTenantRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const userId = session?.user.id;
    if (previousUserIdRef.current !== userId) {
      runInBackground(queryClient.cancelQueries(), "auth.cache_cancel_failed", {
        code: "AUTH_CACHE_CANCEL_FAILED",
        operation: "cancelQueries",
      });
      queryClient.clear();
      previousUserIdRef.current = userId;
    }
  }, [queryClient, session?.user.id]);

  useEffect(() => {
    if (!initialized) return;
    let active = true;
    setPreparedStateKey(undefined);
    setPreparationFailed(false);
    void (async () => {
      await serializeCaptureWork(async () => {
        const previous = previousCaptureTenantRef.current;
        if (previous !== undefined && previous !== captureMode.tenantId) {
          await clearLocalStoreForTenant(previous);
          if (!demoModeEnabled()) await clearDeviceSemanticConfig(previous);
          await setBackgroundSyncEnabled(false);
        }
        await prepareCaptureTenant(captureMode.tenantId, captureMode.cleanupTenantId);
        previousCaptureTenantRef.current = captureMode.tenantId;
      });
      if (active) setPreparedStateKey(captureMode.stateKey);
    })().catch((error: unknown) => {
      logMobileError("background.capture_state_preparation_failed", error, {
        code: "CAPTURE_STATE_PREPARATION_FAILED",
        integration: "relay-device-ingress",
        operation: "prepareNotificationCaptureState",
      });
      if (active) setPreparationFailed(true);
    });
    return () => {
      active = false;
    };
  }, [
    captureMode.cleanupTenantId,
    captureMode.stateKey,
    captureMode.tenantId,
    initialized,
    preparationAttempt,
  ]);

  // `seen` is undefined only while the local read is in flight. Holding the existing splash for it
  // is what stops a returning user seeing one frame of the introduction.
  if (!initialized || onboarding.seen === undefined || preparedStateKey !== captureMode.stateKey) {
    if (!preparationFailed) {
      return (
        <LoadingState
          label={initialized ? "Preparing secure device capture..." : "Restoring secure session..."}
        />
      );
    }
    return (
      <FeedbackState
        action={
          <AppButton
            label="Try again"
            onPress={() => setPreparationAttempt((attempt) => attempt + 1)}
            tone="primary"
          />
        }
        detail="Relay could not set up its protected storage on this device. Nothing was captured or lost."
        kind="error"
        title="Relay could not start"
      />
    );
  }

  const appAccessAllowed = canEnterApp(session !== null, localDevelopmentAccess);
  // The introduction runs before sign-in: it explains what Relay would capture, which is what a
  // person needs in order to decide whether to create an account at all.
  const introduced = onboarding.seen === true;

  return (
    <>
      <DeviceCaptureSync key={`capture:${session?.user.id ?? "signed-out"}`} />
      <Stack
        key={`navigation:${session?.user.id ?? "signed-out"}`}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Protected guard={!introduced}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={introduced && appAccessAllowed}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="inbox/[id]" />
          <Stack.Screen name="inbox/hidden" />
          <Stack.Screen name="inbox/apps" />
          <Stack.Screen name="inbox/app/[applicationId]" />
          <Stack.Screen name="inbox/category/[slug]" />
          <Stack.Screen name="rules/editor" />
          <Stack.Screen name="sources" />
          <Stack.Screen name="categories" />
          <Stack.Screen name="smart-automations" />
          <Stack.Screen name="activity" />
          <Stack.Screen name="demo" />
          <Stack.Screen name="disclosures" />
          <Stack.Screen name="your-data" />
          <Stack.Screen name="quiet" />
        </Stack.Protected>
        <Stack.Protected guard={introduced && canEnterSignIn(session !== null)}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={session === null}>
          <Stack.Screen name="auth/callback" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/**
 * The device work that belongs to no screen.
 *
 * Deliberately mounted here rather than in a feature hook. Both passes below are about what the
 * phone holds, not about what is on screen, and the quiet pass in particular must not be reachable
 * from the inbox: `features/inbox/models/dismissalBoundary.test.ts` asserts structurally that no
 * inbox surface can reach the capability that acts on a notification, and putting this in `useInbox`
 * would have been one edit away from a swipe cancelling a notification.
 */
/**
 * How long a capture waits for its neighbours before a sync pass runs.
 *
 * Notifications arrive in bursts and one pass delivers everything queued, so this is the difference
 * between one upload and ten. Short enough that a reader watching the inbox sees the row appear
 * rather than wait for it.
 */
const CAPTURE_SYNC_COALESCE_MS = 1_200;

function DeviceCaptureSync() {
  const { client, session } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session === null) return;
    const tenantId = session.user.id;
    const sync = () => {
      runInBackground(
        syncDeviceCaptures(session, async () => {
          await queryClient.invalidateQueries({ queryKey: ["inbox-local", tenantId] });
        }).finally(async () => {
          await queryClient.invalidateQueries({ queryKey: ["inbox", tenantId] });
        }),
        "background.device_capture_sync_failed",
        {
          code: "DEVICE_CAPTURE_SYNC_FAILED",
          integration: "relay-device-ingress",
          operation: "syncDeviceCaptures",
        },
      );
      // Finishes the quiet decisions the notification listener could not make. The listener runs in
      // a system-bound process with no session and cannot reach a model, so a rule carrying a
      // semantic clause records a candidate and leaves the notification alone; this pass and the
      // background delivery task are the only two that come back for it (ADR-0019).
      //
      // Separate from filing, because a candidate exists whether or not anything needs filing, and
      // a pass that only ran alongside a classification write would leave notifications waiting.
      if (client !== undefined) {
        runInBackground(
          resolvePendingSilencesForTenant(client, tenantId),
          "silence.resolution_pass_failed",
          {
            code: "SILENCE_RESOLUTION_PASS_FAILED",
            integration: "relay-device-ingress",
            operation: "resolvePendingSilencesForTenant",
          },
        );
      }
    };
    sync();

    /*
      A capture arriving is the signal; a timer was only ever standing in for it. The listener
      enqueues the moment Android posts, so with the app open the runtime that can deliver it is
      already running -- waiting for the next resume or the fifteen-minute task was latency with no
      cause behind it.

      Coalesced, because notifications arrive in bursts and one sync pass delivers everything queued.
      The delay is what turns ten arrivals into one upload rather than ten.
    */
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = RelayDeviceIngress.addCaptureListener(() => {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        sync();
      }, CAPTURE_SYNC_COALESCE_MS);
    });
    // The scheduled work and the stored preference can fall out of step -- a reinstall, a restore to
    // a new device, or a system that dropped the job -- so the choice a person last made is
    // re-applied on launch rather than assumed to still be in force.
    runInBackground(
      restoreBackgroundSyncRegistration(),
      "background.capture_sync_registration_failed",
      {
        code: "BACKGROUND_CAPTURE_SYNC_REGISTRATION_FAILED",
        integration: "relay-device-ingress",
        operation: "restoreBackgroundSyncRegistration",
      },
    );
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => {
      subscription.remove();
      unsubscribe();
      if (pending !== undefined) clearTimeout(pending);
    };
  }, [client, queryClient, session]);

  return null;
}

function ThemedRoot() {
  const theme = useRelayTheme();
  return (
    <AuthProvider>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <OnboardingProvider>
        <AuthenticatedStack />
      </OnboardingProvider>
    </AuthProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ...MaterialCommunityIcons.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000 },
          mutations: { retry: false },
        },
      }),
  );

  useEffect(() => {
    if (fontsLoaded || fontError !== null) {
      runInBackground(SplashScreen.hideAsync(), "ui.splash_hide_failed", {
        code: "SPLASH_HIDE_FAILED",
        integration: "expo-splash-screen",
        operation: "hideAsync",
      });
    }
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && fontError === null) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <RelayThemeProvider>
          <QueryClientProvider client={queryClient}>
            <SubscriptionProvider>
              <ThemedRoot />
            </SubscriptionProvider>
          </QueryClientProvider>
        </RelayThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
