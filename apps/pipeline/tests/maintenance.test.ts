import { describe, expect, it, vi } from "vitest";

import { generateKek } from "@relay/crypto";

import type { Env } from "../src/env";
import { runScheduledMaintenance } from "../src/maintenance";

function environment(): Env {
  return {
    RELAY_CREDENTIAL_KEK_KEYRING: JSON.stringify({
      activeVersion: 1,
      keys: { 1: generateKek() },
    }),
    RELAY_ENVIRONMENT: "development",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
    SUPABASE_URL: "https://supabase.example.test",
  } as unknown as Env;
}

describe("scheduled pipeline maintenance", () => {
  it("purges expired payloads before inventorying KEK versions", async () => {
    const requests: string[] = [];
    const fetcher = vi.fn((input: string) => {
      requests.push(new URL(input).pathname);
      return Promise.resolve(Response.json(requests.length === 1 ? 0 : []));
    });

    await runScheduledMaintenance(environment(), fetcher);

    expect(requests).toEqual([
      "/rest/v1/rpc/purge_expired_raw_payloads",
      "/rest/v1/rpc/kek_encryption_inventory",
    ]);
  });

  it("does not rotate when retention cleanup fails", async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 503 })));

    await expect(runScheduledMaintenance(environment(), fetcher)).rejects.toThrow(
      "Retention cleanup failed with 503",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
