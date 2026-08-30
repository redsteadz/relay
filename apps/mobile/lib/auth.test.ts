import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@relay/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearDeletedAccountLocalState,
  clearRelaySession,
  createAutoRefreshController,
  exchangeMagicLink,
  MOBILE_AUTH_CALLBACK_URL,
  requestMagicLink,
  validCallbackCode,
} from "./auth";
import { reportUnexpectedUiError } from "./observability";

function clientWithAuth(auth: object): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

describe("mobile auth operations", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests a PKCE callback for an existing approved account", async () => {
    const signInWithOtp = vi.fn(() => Promise.resolve({ data: {}, error: null }));
    const client = clientWithAuth({ signInWithOtp });

    await requestMagicLink(client, "  tester@example.test ");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "tester@example.test",
      options: {
        emailRedirectTo: MOBILE_AUTH_CALLBACK_URL,
        shouldCreateUser: false,
      },
    });
  });

  it("exchanges one callback code without reflecting provider errors", async () => {
    const session = { access_token: "synthetic" } as Session;
    const exchangeCodeForSession = vi.fn(
      (): Promise<{
        data: { session: Session | null; user: null };
        error: Error | null;
      }> => Promise.resolve({ data: { session, user: null }, error: null }),
    );

    await expect(
      exchangeMagicLink(clientWithAuth({ exchangeCodeForSession }), "opaque-code"),
    ).resolves.toBe(session);

    exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error("provider detail must remain private"),
    });
    await expect(
      exchangeMagicLink(clientWithAuth({ exchangeCodeForSession }), "rejected-code"),
    ).rejects.toThrow("Magic-link exchange failed");
  });

  it("clears only this device session", async () => {
    const signOut = vi.fn(() => Promise.resolve({ error: null }));

    await clearRelaySession(clientWithAuth({ signOut }));

    expect(signOut).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("reports one queue incident and throws classified terminal cleanup status", async () => {
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queueFailure = new Error("synthetic queue detail");
    const cleanup = clearDeletedAccountLocalState({
      clearCaptureQueue: () => Promise.reject(queueFailure),
      clearSession: () => Promise.resolve(),
    });

    const terminal = (await cleanup.catch((error: unknown) => error)) as AppError;

    expect(terminal).toBeInstanceOf(AppError);
    expect(terminal).toMatchObject({
      category: "internal",
      code: "AUTH_DELETED_ACCOUNT_CLEANUP_FAILED",
      operation: "clearDeletedAccountSession",
      retryable: false,
    });
    expect(terminal.cause).toBe(queueFailure);
    reportUnexpectedUiError(terminal, "ui.account_deletion_failed", {
      code: "ACCOUNT_DELETION_UI_FAILED",
      integration: "relay-api",
      operation: "deleteAccount",
    });
    expect(loggedError).toHaveBeenCalledOnce();
    expect(JSON.parse(loggedError.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "auth.deleted_account_queue_cleanup_failed",
      error: { code: "AUTH_LOCAL_QUEUE_CLEANUP_FAILED" },
    });
    expect(loggedError.mock.calls[0]?.[0]).not.toContain("synthetic queue detail");
  });

  it("reports one sign-out incident and preserves its classified cause", async () => {
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const signOut = vi.fn(() => Promise.resolve({ error: new Error("synthetic provider detail") }));
    const cleanup = clearDeletedAccountLocalState({
      clearCaptureQueue: () => Promise.resolve(),
      clearSession: () => clearRelaySession(clientWithAuth({ signOut })),
    });

    const terminal = (await cleanup.catch((error: unknown) => error)) as AppError;

    expect(terminal).toBeInstanceOf(AppError);
    expect(terminal).toMatchObject({
      category: "internal",
      code: "AUTH_DELETED_ACCOUNT_CLEANUP_FAILED",
      operation: "clearDeletedAccountSession",
      retryable: false,
    });
    expect(terminal.cause).toMatchObject({
      category: "internal",
      code: "AUTH_LOCAL_SIGN_OUT_FAILED",
      operation: "signOut",
    });
    reportUnexpectedUiError(terminal, "ui.account_deletion_failed", {
      code: "ACCOUNT_DELETION_UI_FAILED",
      integration: "relay-api",
      operation: "deleteAccount",
    });
    expect(loggedError).toHaveBeenCalledOnce();
    expect(JSON.parse(loggedError.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "auth.local_sign_out_failed",
      error: { code: "AUTH_LOCAL_SIGN_OUT_FAILED" },
    });
    expect(loggedError.mock.calls[0]?.[0]).not.toContain("synthetic provider detail");
  });

  it("serializes active and background refresh transitions", async () => {
    let finishStart: (() => void) | undefined;
    const startAutoRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        }),
    );
    const stopAutoRefresh = vi.fn(() => Promise.resolve());
    const refresh = createAutoRefreshController({ startAutoRefresh, stopAutoRefresh });

    const active = refresh.setActive(true);
    const background = refresh.setActive(false);
    await Promise.resolve();
    expect(startAutoRefresh).toHaveBeenCalledOnce();
    expect(stopAutoRefresh).not.toHaveBeenCalled();

    finishStart?.();
    await Promise.all([active, background]);
    expect(stopAutoRefresh).toHaveBeenCalledOnce();
    expect(startAutoRefresh.mock.invocationCallOrder[0]).toBeLessThan(
      stopAutoRefresh.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("accepts one bounded callback code only", () => {
    expect(validCallbackCode("opaque-code")).toBe("opaque-code");
    expect(validCallbackCode(["one", "two"])).toBeUndefined();
    expect(validCallbackCode("")).toBeUndefined();
    expect(validCallbackCode("x".repeat(2049))).toBeUndefined();
  });
});
