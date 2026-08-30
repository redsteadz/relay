import type { SupabaseClient } from "@supabase/supabase-js";

import { logMobileError } from "./observability";
import { createRelaySupabaseClient } from "./supabase";

let configurationFailureReported = false;

export function createConfiguredClient(): SupabaseClient | undefined {
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
