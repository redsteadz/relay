import type { Session, SupabaseClient } from "@supabase/supabase-js";

export const MOBILE_AUTH_CALLBACK_URL = "com.redsteadz.relay://auth/callback";

type AutoRefreshAuth = {
  startAutoRefresh: () => Promise<void>;
  stopAutoRefresh: () => Promise<void>;
};

export function createAutoRefreshController(auth: AutoRefreshAuth) {
  let operation = Promise.resolve();
  return {
    setActive(active: boolean): Promise<void> {
      operation = operation
        .then(() => (active ? auth.startAutoRefresh() : auth.stopAutoRefresh()))
        .catch(() => undefined);
      return operation;
    },
  };
}

export function validCallbackCode(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 ? value : undefined;
}

export async function requestMagicLink(client: SupabaseClient, email: string): Promise<void> {
  try {
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: MOBILE_AUTH_CALLBACK_URL,
        shouldCreateUser: false,
      },
    });
    if (error !== null) throw new Error("Magic-link request failed");
  } catch {
    throw new Error("Magic-link request failed");
  }
}

export async function exchangeMagicLink(client: SupabaseClient, code: string): Promise<Session> {
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error !== null || data.session === null) throw new Error("Magic-link exchange failed");
    return data.session;
  } catch {
    throw new Error("Magic-link exchange failed");
  }
}

export async function clearRelaySession(client: SupabaseClient): Promise<void> {
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error !== null) throw new Error("Local sign-out failed");
  } catch {
    throw new Error("Local sign-out failed");
  }
}
