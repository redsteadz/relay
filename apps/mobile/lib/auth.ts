import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@relay/observability";

import { logMobileError } from "./observability";

export const MOBILE_AUTH_CALLBACK_URL = "com.redsteadz.relay://auth/callback";

type AutoRefreshAuth = {
  startAutoRefresh: () => Promise<void>;
  stopAutoRefresh: () => Promise<void>;
};

type DeletedAccountLocalCleanup = {
  clearCaptureQueue?: (() => Promise<void>) | undefined;
  clearSession?: (() => Promise<void>) | undefined;
};

export function createAutoRefreshController(auth: AutoRefreshAuth) {
  let operation = Promise.resolve();
  return {
    setActive(active: boolean): Promise<void> {
      operation = operation
        .then(() => (active ? auth.startAutoRefresh() : auth.stopAutoRefresh()))
        .catch((error: unknown) => {
          logMobileError("auth.auto_refresh_failed", error, {
            code: "AUTH_AUTO_REFRESH_FAILED",
            integration: "supabase-auth",
            operation: active ? "startAutoRefresh" : "stopAutoRefresh",
          });
        });
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
    if (error !== null) throw error;
  } catch (error: unknown) {
    const normalized = new AppError("Magic-link request failed", {
      category: "upstream-service",
      cause: error,
      code: "AUTH_MAGIC_LINK_REQUEST_FAILED",
      integration: "supabase-auth",
      operation: "signInWithOtp",
    });
    logMobileError("auth.magic_link_request_failed", normalized, {
      code: normalized.code,
      integration: "supabase-auth",
      operation: "signInWithOtp",
    });
    throw normalized;
  }
}

export async function exchangeMagicLink(client: SupabaseClient, code: string): Promise<Session> {
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error !== null) throw error;
    if (data.session === null) throw new Error("Supabase returned no session");
    return data.session;
  } catch (error: unknown) {
    const normalized = new AppError("Magic-link exchange failed", {
      category: "unauthorized",
      cause: error,
      code: "AUTH_MAGIC_LINK_EXCHANGE_FAILED",
      integration: "supabase-auth",
      operation: "exchangeCodeForSession",
      retryable: false,
    });
    logMobileError("auth.magic_link_exchange_failed", normalized, {
      code: normalized.code,
      integration: "supabase-auth",
      operation: "exchangeCodeForSession",
    });
    throw normalized;
  }
}

export async function clearRelaySession(client: SupabaseClient): Promise<void> {
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error !== null) throw error;
  } catch (error: unknown) {
    const normalized = new AppError("Local sign-out failed", {
      category: "internal",
      cause: error,
      code: "AUTH_LOCAL_SIGN_OUT_FAILED",
      integration: "supabase-auth",
      operation: "signOut",
    });
    logMobileError("auth.local_sign_out_failed", normalized, {
      code: normalized.code,
      integration: "supabase-auth",
      operation: "signOut",
    });
    throw normalized;
  }
}

export async function clearDeletedAccountLocalState({
  clearCaptureQueue,
  clearSession,
}: DeletedAccountLocalCleanup): Promise<void> {
  let cleanupFailed = false;
  let cleanupCause: unknown;

  if (clearCaptureQueue !== undefined) {
    try {
      await clearCaptureQueue();
    } catch (error: unknown) {
      logMobileError("auth.deleted_account_queue_cleanup_failed", error, {
        code: "AUTH_LOCAL_QUEUE_CLEANUP_FAILED",
        integration: "relay-device-ingress",
        operation: "clearCaptureQueue",
      });
      cleanupFailed = true;
      cleanupCause = error;
    }
  }

  if (clearSession === undefined) {
    cleanupFailed = true;
    cleanupCause ??= new AppError("Auth configuration is unavailable", {
      category: "configuration",
      code: "AUTH_CONFIGURATION_FAILED",
      integration: "supabase-auth",
      operation: "createRelaySupabaseClient",
      retryable: false,
    });
  } else {
    try {
      await clearSession();
    } catch (error: unknown) {
      // clearRelaySession logs the underlying Supabase failure once.
      cleanupFailed = true;
      cleanupCause ??= error;
    }
  }

  if (cleanupFailed) {
    throw new AppError("Deleted account local cleanup was incomplete", {
      category: "internal",
      cause: cleanupCause,
      code: "AUTH_DELETED_ACCOUNT_CLEANUP_FAILED",
      operation: "clearDeletedAccountSession",
      retryable: false,
    });
  }
}
