import type { SupabaseClient } from "@supabase/supabase-js";

import { createDemoSupabaseClient } from "./demo/client";
import { demoModeEnabled } from "./demo/mode";
import { logMobileError } from "./observability";
import { createRelaySupabaseClient } from "./supabase";

let configurationFailureReported = false;

export function createConfiguredClient(): SupabaseClient | undefined {
  // The single place a client is built, and so the single place demo mode has to replace one. Every
  // caller downstream keeps its own queries, its own error handling, and its own contract parsing.
  if (demoModeEnabled()) return createDemoSupabaseClient();
  try {
    return createRelaySupabaseClient();
  } catch (error: unknown) {
    if (!configurationFailureReported) {
      configurationFailureReported = true;
      logMobileError("auth.configuration_failed", error, {
        code: "AUTH_CONFIGURATION_FAILED",
        integration: "supabase-auth",
        operation: "createRelaySupabaseClient",
      });
    }
    return undefined;
  }
}
