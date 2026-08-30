import { describe, expect, it, vi } from "vitest";

import { generateKek } from "@relay/crypto";

import type { Env } from "../src/env";
import { MAINTENANCE_TASK_TIMEOUT_MS, runScheduledMaintenance } from "../src/maintenance";

function environment(): Env {
  return {
    RELAY_CREDENTIAL_KEK_KEYRING: JSON.stringify({
      activeVersion: 1,
      keys: { 1: generateKek() },
    }),
    RELAY_ENVIRONMENT: "development",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_backend_key_12345",
    SUPABASE_URL: "https://supabase.example.test",
  } as unknown as Env;
}

describe("scheduled pipeline maintenance", () => {
  it("attempts retention, KEK rotation, and Gmail maintenance concurrently", async () => {
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
      {
        body: JSON.stringify({ p_limit: 50 }),
        path: "/rest/v1/rpc/list_due_gmail_connections_v1",
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

    const fetcher = vi.fn((input: string) =>
      Promise.resolve(Response.json(new URL(input).pathname.includes("kek_") ? [] : [])),
    );

    await expect(runScheduledMaintenance(env, fetcher)).rejects.toThrow(
      "Scheduled maintenance failed: retention",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects controlled time for a hosted Supabase URL", async () => {
    const env = {
      ...environment(),
      RELAY_E2E_MODE: "true",
      RELAY_E2E_RETENTION_NOW: "2030-01-01T00:00:00.000Z",
    };

    const fetcher = vi.fn(() => Promise.resolve(Response.json([])));

    await expect(runScheduledMaintenance(env, fetcher)).rejects.toThrow(
      "Scheduled maintenance failed: retention",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [["retention"]],
    [["kek-rotation"]],
    [["gmail"]],
    [["retention", "kek-rotation"]],
    [["retention", "gmail"]],
    [["kek-rotation", "gmail"]],
    [["retention", "kek-rotation", "gmail"]],
  ] as const)("attempts every maintenance task when failures are %j", async (failures) => {
    const failed = new Set<string>(failures);
    const requests: string[] = [];
    const fetcher = vi.fn((input: string) => {
      const path = new URL(input).pathname;
      requests.push(path);
      if (path.endsWith("/purge_expired_raw_payloads")) {
        return Promise.resolve(
          failed.has("retention") ? new Response(null, { status: 503 }) : Response.json(0),
        );
      }
      if (path.endsWith("/kek_encryption_inventory")) {
        return Promise.resolve(
          failed.has("kek-rotation") ? new Response(null, { status: 503 }) : Response.json([]),
        );
      }
      if (path.endsWith("/list_due_gmail_connections_v1")) {
        return Promise.resolve(
          failed.has("gmail") ? new Response(null, { status: 503 }) : Response.json([]),
        );
      }
      throw new Error("unexpected synthetic request");
    });

    await expect(runScheduledMaintenance(environment(), fetcher)).rejects.toThrow(
      `Scheduled maintenance failed: ${failures.join(",")}`,
    );
    expect(requests).toEqual([
      "/rest/v1/rpc/purge_expired_raw_payloads",
      "/rest/v1/rpc/kek_encryption_inventory",
      "/rest/v1/rpc/list_due_gmail_connections_v1",
    ]);
  });

  it("isolates one mailbox scheduling failure from other mailboxes", async () => {
    const firstFetch = vi.fn(() => Promise.reject(new Error("synthetic mailbox failure")));
    const secondFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    const getByName = vi
      .fn()
      .mockReturnValueOnce({ fetch: firstFetch })
      .mockReturnValueOnce({ fetch: secondFetch });
    const env = {
      ...environment(),
      TENANT_COORDINATOR: { getByName },
    } as unknown as Env;
    let request = 0;
    const fetcher = vi.fn(() => {
      request += 1;
      if (request === 1) return Promise.resolve(Response.json(0));
      if (request === 2) return Promise.resolve(Response.json([]));
      return Promise.resolve(
        Response.json([
          {
            connection_id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
            reconcile_history: true,
            renew_watch: true,
            user_id: "638ce145-a77d-4c32-b798-cb398e881fc9",
          },
          {
            connection_id: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
            reconcile_history: true,
            renew_watch: false,
            user_id: "42ad95f2-20b0-4b23-83af-ebcb560219df",
          },
        ]),
      );
    });

    await expect(runScheduledMaintenance(env, fetcher)).rejects.toThrow(
      "Scheduled maintenance failed: gmail",
    );

    expect(getByName).toHaveBeenCalledTimes(2);
    expect(firstFetch).toHaveBeenCalledOnce();
    expect(secondFetch).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("times out one never-resolving job without suppressing independent maintenance", async () => {
    vi.useFakeTimers();
    try {
      const requests: string[] = [];
      let retentionSignal: AbortSignal | undefined;
      const fetcher = vi.fn((input: string, init?: RequestInit) => {
        const path = new URL(input).pathname;
        requests.push(path);
        if (path.endsWith("/purge_expired_raw_payloads")) {
          retentionSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        }
        return Promise.resolve(Response.json([]));
      });

      const maintenance = runScheduledMaintenance(environment(), fetcher);
      const rejection = expect(maintenance).rejects.toThrow(
        "Scheduled maintenance failed: retention",
      );
      await vi.advanceTimersByTimeAsync(MAINTENANCE_TASK_TIMEOUT_MS);

      await rejection;
      expect(requests).toEqual([
        "/rest/v1/rpc/purge_expired_raw_payloads",
        "/rest/v1/rpc/kek_encryption_inventory",
        "/rest/v1/rpc/list_due_gmail_connections_v1",
      ]);
      expect(retentionSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
