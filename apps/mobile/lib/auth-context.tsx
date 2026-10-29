import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  type PropsWithChildren,
  startTransition,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import { AppState, Platform } from "react-native";

import {
  clearDeletedAccountLocalState,
  clearRelaySession,
  createAutoRefreshController,
  exchangeMagicLink,
  requestMagicLink,
} from "./auth";
import { createConfiguredClient } from "./auth-configuration";
import { logMobileError } from "./observability";
import RelayDeviceIngress from "../modules/relay-device-ingress";
import { clearLocalStoreForTenant } from "./local-store";
import { blockCaptureWork, resumeCaptureWork } from "./capture-work";
import { finishCaptureSignOut } from "./capture-logout";
import { prepareCaptureTenant } from "./capture-preparation";
import { syncDeviceCaptures } from "./device-capture-sync";
import { useQueryClient } from "@tanstack/react-query";
import { clearDeviceSemanticConfig } from "./device-semantic-config";
import { demoModeEnabled } from "./demo/mode";
import { setBackgroundSyncEnabled } from "./background-capture-sync";

type AuthContextValue = {
  client: SupabaseClient | undefined;
  clearDeletedAccountSession: () => Promise<void>;
  completeMagicLink: (code: string) => Promise<void>;
  configurationError: boolean;
  initialized: boolean;
  requestMagicLink: (email: string) => Promise<void>;
  session: Session | null;
  signOut: (discard?: boolean) => Promise<number>;
  syncBeforeSignOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [client] = useState(createConfiguredClient);
  const [initialized, setInitialized] = useState(client === undefined);
  const [session, setSession] = useState<Session | null>(null);
  const accountRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (client === undefined) return;
    let active = true;
    let authEventReceived = false;
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      authEventReceived = true;
      if (accountRef.current !== nextSession?.user.id) {
        if (accountRef.current !== undefined) blockCaptureWork(accountRef.current);
        queryClient.clear();
      }
      accountRef.current = nextSession?.user.id;
      if (nextSession !== null) resumeCaptureWork(nextSession.user.id);
      startTransition(() => {
        setSession(nextSession);
        setInitialized(true);
      });
    });
    void client.auth
      .getSession()
      .then(({ data: current }) => {
        if (!active || authEventReceived) return;
        accountRef.current = current.session?.user.id;
        if (current.session !== null) resumeCaptureWork(current.session.user.id);
        startTransition(() => {
          setSession(current.session);
          setInitialized(true);
        });
      })
      .catch((error: unknown) => {
        logMobileError("auth.session_restore_failed", error, {
          code: "AUTH_SESSION_RESTORE_FAILED",
          integration: "supabase-auth",
          operation: "getSession",
        });
        if (!active || authEventReceived) return;
        startTransition(() => {
          setSession(null);
          setInitialized(true);
        });
      });

    if (Platform.OS !== "web") {
      const autoRefresh = createAutoRefreshController(client.auth);
      void autoRefresh.setActive(AppState.currentState === "active");
      const appState = AppState.addEventListener("change", (state) => {
        void autoRefresh.setActive(state === "active");
      });
      return () => {
        active = false;
        appState.remove();
        data.subscription.unsubscribe();
        void autoRefresh.setActive(false);
      };
    }

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client, queryClient]);

  async function completeMagicLink(code: string) {
    if (client === undefined) throw new Error("Auth configuration is unavailable");
    if (session !== null) throw new Error("Sign out before changing accounts");
    const nextSession = await exchangeMagicLink(client, code);
    resumeCaptureWork(nextSession.user.id);
    startTransition(() => setSession(nextSession));
  }

  async function sendMagicLink(email: string) {
    if (client === undefined) throw new Error("Auth configuration is unavailable");
    await requestMagicLink(client, email);
  }

  async function syncBeforeSignOut() {
    if (session === null) return;
    await syncDeviceCaptures(session, undefined, true);
  }

  async function signOut(discard = false): Promise<number> {
    if (client === undefined) throw new Error("Auth configuration is unavailable");
    const tenantId = session?.user.id;
    return finishCaptureSignOut(tenantId, discard, {
      prepare: prepareCaptureTenant,
      finishCaptures: (tenant, allowDiscard) =>
        RelayDeviceIngress.finishCaptureLogout(tenant, allowDiscard),
      clearDerived: async (tenant) => {
        await clearLocalStoreForTenant(tenant);
        if (!demoModeEnabled()) await clearDeviceSemanticConfig(tenant);
        await setBackgroundSyncEnabled(false);
      },
      clearCaches: async () => {
        await queryClient.cancelQueries();
        queryClient.clear();
      },
      clearSession: async () => {
        await clearRelaySession(client);
        startTransition(() => setSession(null));
      },
    });
  }

  async function clearDeletedAccountSession() {
    const tenantId = session?.user.id;
    try {
      await clearDeletedAccountLocalState({
        ...(tenantId === undefined
          ? {}
          : {
              clearCaptureQueue: () => RelayDeviceIngress.clearCaptureQueue(tenantId),
              clearLocalStore: () => clearLocalStoreForTenant(tenantId),
            }),
        ...(client === undefined ? {} : { clearSession: () => clearRelaySession(client) }),
      });
    } finally {
      startTransition(() => setSession(null));
    }
  }

  return (
    <AuthContext.Provider
      value={{
        client,
        clearDeletedAccountSession,
        completeMagicLink,
        configurationError: client === undefined,
        initialized,
        requestMagicLink: sendMagicLink,
        session,
        signOut,
        syncBeforeSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
