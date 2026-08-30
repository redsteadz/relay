import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  type PropsWithChildren,
  startTransition,
  useContext,
  useEffect,
  useState,
} from "react";
import { AppState, Platform } from "react-native";

import {
  clearRelaySession,
  createAutoRefreshController,
  exchangeMagicLink,
  requestMagicLink,
} from "./auth";
import { createRelaySupabaseClient } from "./supabase";
import RelayDeviceIngress from "../modules/relay-device-ingress";

type AuthContextValue = {
  client: SupabaseClient | undefined;
  clearDeletedAccountSession: () => Promise<void>;
  completeMagicLink: (code: string) => Promise<void>;
  configurationError: boolean;
  initialized: boolean;
  requestMagicLink: (email: string) => Promise<void>;
  session: Session | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function createConfiguredClient(): SupabaseClient | undefined {
  try {
    return createRelaySupabaseClient();
  } catch {
    return undefined;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [client] = useState(createConfiguredClient);
  const [initialized, setInitialized] = useState(client === undefined);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (client === undefined) return;
    let active = true;
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      startTransition(() => {
        setSession(nextSession);
        setInitialized(true);
      });
    });
    void client.auth
      .getSession()
      .then(({ data: current }) => {
        if (!active) return;
        startTransition(() => {
          setSession(current.session);
          setInitialized(true);
        });
      })
      .catch(() => {
        if (!active) return;
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
  }, [client]);

  async function completeMagicLink(code: string) {
    if (client === undefined) throw new Error("Auth configuration is unavailable");
    const nextSession = await exchangeMagicLink(client, code);
    startTransition(() => setSession(nextSession));
  }

  async function sendMagicLink(email: string) {
    if (client === undefined) throw new Error("Auth configuration is unavailable");
    await requestMagicLink(client, email);
  }

  async function signOut() {
    if (client === undefined) throw new Error("Auth configuration is unavailable");
    const tenantId = session?.user.id;
    if (tenantId !== undefined) await RelayDeviceIngress.clearCaptureQueue(tenantId);
    await clearRelaySession(client);
    startTransition(() => setSession(null));
  }

  async function clearDeletedAccountSession() {
    let cleanupFailed = false;
    const tenantId = session?.user.id;
    if (tenantId !== undefined) {
      try {
        await RelayDeviceIngress.clearCaptureQueue(tenantId);
      } catch {
        cleanupFailed = true;
      }
    }
    if (client === undefined) cleanupFailed = true;
    else {
      try {
        await clearRelaySession(client);
      } catch {
        cleanupFailed = true;
      }
    }
    startTransition(() => setSession(null));
    if (cleanupFailed) throw new Error("Deleted account local cleanup was incomplete");
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
