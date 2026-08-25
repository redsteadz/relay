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
    const requests: { body: BodyInit | null | undefined; path: string }[] = [];
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      requests.push({ body: init?.body, path: new URL(input).pathname });
      return Promise.resolve(Response.json(requests.length === 1 ? 0 : []));
    });

    await runScheduledMaintenance(environment(), fetcher);

    expect(requests).toEqual([
      { body: "{}", path: "/rest/v1/rpc/purge_expired_raw_payloads" },
      {
        body: JSON.stringify({ p_environment: "development" }),
        path: "/rest/v1/rpc/kek_encryption_inventory",
      },
    ]);
  });

  it("passes controlled time only in explicit e2e mode", async () => {
    const env = {
      ...environment(),
      RELAY_E2E_MODE: "true",
      RELAY_E2E_RETENTION_NOW: "2030-01-01T00:00:00.000Z",
      SUPABASE_URL: "http://127.0.0.1:55321",
    };
    let retentionBody: BodyInit | null | undefined;
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      if (new URL(input).pathname.endsWith("/purge_expired_raw_payloads")) {
        retentionBody = init?.body;
        return Promise.resolve(Response.json(1));
      }
      return Promise.resolve(Response.json([]));
    });

    await runScheduledMaintenance(env, fetcher);

    expect(retentionBody).toBe(JSON.stringify({ p_now: "2030-01-01T00:00:00.000Z" }));
  });

  it("rejects controlled time outside e2e mode", async () => {
    const env = {
      ...environment(),
      RELAY_E2E_RETENTION_NOW: "2030-01-01T00:00:00.000Z",
    };

    await expect(runScheduledMaintenance(env, vi.fn())).rejects.toThrow(
      "Controlled retention time is invalid",
    );
  });

  it("rejects controlled time for a hosted Supabase URL", async () => {
    const env = {
      ...environment(),
      RELAY_E2E_MODE: "true",
      RELAY_E2E_RETENTION_NOW: "2030-01-01T00:00:00.000Z",
    };

    await expect(runScheduledMaintenance(env, vi.fn())).rejects.toThrow(
      "Controlled retention time is invalid",
    );
  });

  it("does not rotate when retention cleanup fails", async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 503 })));

    await expect(runScheduledMaintenance(environment(), fetcher)).rejects.toThrow(
      "Retention cleanup failed with 503",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
