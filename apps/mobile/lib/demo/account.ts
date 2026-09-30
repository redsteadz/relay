import type { Session } from "@supabase/supabase-js";

import { demoUuid } from "./ids";

export const DEMO_USER_ID = demoUuid("user:demo");
export const DEMO_EMAIL = "demo@relay.invalid";

/**
 * The session every demo screen reads.
 *
 * Screens branch on `session === null` to decide whether an account-owned surface can be shown at
 * all, and `session.user.id` is the tenant every local table is keyed by, so the demo needs a real
 * session object rather than a stub. The token is a fixed placeholder: nothing in demo mode sends it
 * anywhere, because the Relay API transport is replaced alongside the Supabase client.
 */
export function createDemoSession(): Session {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    access_token: "relay-demo-access-token",
    expires_at: issuedAt + 60 * 60 * 24 * 365,
    expires_in: 60 * 60 * 24 * 365,
    refresh_token: "relay-demo-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "email", providers: ["email"] },
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      email: DEMO_EMAIL,
      id: DEMO_USER_ID,
      user_metadata: {},
    },
  };
}
