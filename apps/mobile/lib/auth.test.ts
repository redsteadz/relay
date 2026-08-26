import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  clearRelaySession,
  createAutoRefreshController,
  exchangeMagicLink,
  MOBILE_AUTH_CALLBACK_URL,
  requestMagicLink,
  validCallbackCode,
} from "./auth";

function clientWithAuth(auth: object): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

describe("mobile auth operations", () => {
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
