import type { ActionIntent } from "@relay/contracts";
import { encryptValue, generateKek, type KekKeyring } from "@relay/crypto";
import { describe, expect, it, vi } from "vitest";

import type { PersistenceConfiguration } from "../src/configuration";
import { base64ToPostgresBytea, connectionCredentialEncryptionContext } from "../src/encryption";
import {
  WebhookDeliveryError,
  classifyWebhookStatus,
  deliverWebhook,
  isRetryableWebhookFailure,
  loadWebhookDestination,
  webhookSignature,
} from "../src/webhook-provider";

const userId = "cbf55db3-fabe-460d-af9e-68f49cfcaa78";
const connectionId = "23868f8c-0639-42ad-9499-04d98e986380";
const secret = "a".repeat(64);
const previousSecret = "b".repeat(64);
const now = new Date("2026-10-31T12:00:00.000Z");

const intent: ActionIntent = {
  id: "6f98ad81-f071-418b-a426-8c8c9f627161",
  eventId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
  ruleId: "9a4f0d21-3f4c-4c2e-8f7a-1d0b6c9e5a33",
  provider: "webhook",
  approval: "approved",
  operation: "deliver",
  input: { eventType: "task", fields: { title: "Review order" } },
  createdAt: "2026-10-31T11:59:00Z",
};

const destination = { secrets: [secret], url: "https://hooks.example.com/relay" };

type Captured = { init: RequestInit; url: string };

function receiver(status: number, captured: Captured[] = [], type: ResponseType = "default") {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      init: init ?? {},
      url: input instanceof Request ? input.url : input.toString(),
    });
    const response = new Response(status === 204 ? null : "receiver text", { status });
    if (type !== "default") Object.defineProperty(response, "type", { value: type });
    return Promise.resolve(response);
  });
}

async function failure(promise: Promise<unknown>): Promise<WebhookDeliveryError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof WebhookDeliveryError)) throw new Error("expected a delivery failure");
  return error;
}

function hexBytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array((value.match(/../gu) ?? []).map((pair) => Number.parseInt(pair, 16)));
}

/**
 * What docs/integrations/webhook.md tells a receiver to do, written independently of the sender: it
 * verifies with `crypto.subtle.verify` rather than recomputing and comparing hex.
 */
async function receiverAccepts(
  headers: Record<string, string>,
  body: Uint8Array,
  secrets: string[],
): Promise<boolean> {
  const parsed = JSON.parse(new TextDecoder().decode(body)) as { actionId: string };
  if (headers["relay-action-id"] !== parsed.actionId) return false;
  const signed = new Uint8Array([
    ...new TextEncoder().encode(`${headers["relay-timestamp"] ?? ""}.`),
    ...body,
  ]);
  const offered = (headers["relay-signature"] ?? "")
    .split(",")
    .flatMap((entry) => (entry.startsWith("v1=") ? [hexBytes(entry.slice(3))] : []));
  for (const secretValue of secrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secretValue),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    for (const signature of offered) {
      if (await crypto.subtle.verify("HMAC", key, signature, signed)) return true;
    }
  }
  return false;
}

describe("classifyWebhookStatus", () => {
  it.each([
    [200, undefined],
    [204, undefined],
    [301, "webhook-redirect-refused"],
    [307, "webhook-redirect-refused"],
    [400, "webhook-rejected"],
    [401, "webhook-rejected"],
    [404, "webhook-rejected"],
    [408, "webhook-retryable-status"],
    [429, "webhook-retryable-status"],
    [500, "webhook-retryable-status"],
    [503, "webhook-retryable-status"],
  ])("%i is %s", (status, code) => {
    expect(classifyWebhookStatus(status)).toBe(code);
  });

  it("retries only what can succeed later", () => {
    expect(isRetryableWebhookFailure("webhook-unreachable")).toBe(true);
    expect(isRetryableWebhookFailure("webhook-retryable-status")).toBe(true);
    for (const code of [
      "webhook-credential-unavailable",
      "webhook-destination-refused",
      "webhook-invalid-input",
      "webhook-redirect-refused",
      "webhook-rejected",
    ] as const) {
      expect(isRetryableWebhookFailure(code)).toBe(false);
    }
  });
});

describe("deliverWebhook", () => {
  it("sends a body and headers a receiver following the published contract accepts", async () => {
    const captured: Captured[] = [];
    await expect(
      deliverWebhook(destination, intent, 1, receiver(204, captured), { now }),
    ).resolves.toEqual({ statusCode: 204 });

    const [request] = captured;
    if (request === undefined) throw new Error("nothing was sent");
    const headers = request.init.headers as Record<string, string>;
    const body = request.init.body as Uint8Array;
    expect(request.url).toBe("https://hooks.example.com/relay");
    expect(request.init.method).toBe("POST");
    expect(request.init.redirect).toBe("manual");
    expect(headers["relay-timestamp"]).toBe(String(now.getTime() / 1000));
    expect(JSON.parse(new TextDecoder().decode(body))).toEqual({
      version: 1,
      actionId: intent.id,
      eventType: "task",
      attempt: 1,
      fields: { title: "Review order" },
    });
    expect(await receiverAccepts(headers, body, [secret])).toBe(true);
    expect(await receiverAccepts(headers, body, [previousSecret])).toBe(false);
  });

  it("signs with both secrets during a rotation, so a receiver holding either accepts", async () => {
    const captured: Captured[] = [];
    await deliverWebhook(
      { ...destination, secrets: [secret, previousSecret] },
      intent,
      1,
      receiver(200, captured),
      { now },
    );
    const headers = captured[0]?.init.headers as Record<string, string>;
    const body = captured[0]?.init.body as Uint8Array;
    expect(headers["relay-signature"]?.split(",")).toHaveLength(2);
    expect(await receiverAccepts(headers, body, [secret])).toBe(true);
    expect(await receiverAccepts(headers, body, [previousSecret])).toBe(true);
  });

  it("keeps the action ID across attempts and counts the attempt", async () => {
    const captured: Captured[] = [];
    const fetcher = receiver(200, captured);
    await deliverWebhook(destination, intent, 1, fetcher, { now });
    await deliverWebhook(destination, intent, 2, fetcher, { now });
    const bodies = captured.map(
      (request) =>
        JSON.parse(new TextDecoder().decode(request.init.body as Uint8Array)) as {
          actionId: string;
          attempt: number;
        },
    );
    expect(bodies.map((body) => body.actionId)).toEqual([intent.id, intent.id]);
    expect(bodies.map((body) => body.attempt)).toEqual([1, 2]);
  });

  it("rejects a replay that swapped the unsigned action ID header", async () => {
    const captured: Captured[] = [];
    await deliverWebhook(destination, intent, 1, receiver(200, captured), { now });
    const headers = { ...(captured[0]?.init.headers as Record<string, string>) };
    headers["relay-action-id"] = "00000000-0000-4000-8000-000000000000";
    expect(await receiverAccepts(headers, captured[0]?.init.body as Uint8Array, [secret])).toBe(
      false,
    );
  });

  it.each([
    [302, "webhook-redirect-refused"],
    [410, "webhook-rejected"],
    [429, "webhook-retryable-status"],
    [502, "webhook-retryable-status"],
  ] as const)("reports status %i as %s", async (status, code) => {
    const error = await failure(deliverWebhook(destination, intent, 1, receiver(status), { now }));
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
  });

  it("treats an opaque redirect as a refused redirect", async () => {
    const error = await failure(
      deliverWebhook(destination, intent, 1, receiver(200, [], "opaqueredirect"), { now }),
    );
    expect(error.code).toBe("webhook-redirect-refused");
  });

  it("cancels the response body without reading any of it", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull: (controller) => {
          pulls += 1;
          controller.enqueue(new Uint8Array(65_536));
        },
        cancel: () => {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    await deliverWebhook(
      destination,
      intent,
      1,
      () => Promise.resolve(new Response(body, { status: 200 })),
      {
        now,
      },
    );
    expect(pulls).toBe(0);
    expect(cancelled).toBe(true);
  });

  it("reports a network failure as retryable and keeps it as the cause", async () => {
    const cause = new TypeError("fetch failed");
    const error = await failure(
      deliverWebhook(destination, intent, 1, () => Promise.reject(cause), { now }),
    );
    expect(error.code).toBe("webhook-unreachable");
    expect(error.cause).toBe(cause);
  });

  it("gives up on a receiver that never answers", async () => {
    vi.useFakeTimers();
    try {
      let sent!: () => void;
      const inFlight = new Promise<void>((resolve) => {
        sent = resolve;
      });
      const hanging = (_input: string | URL | Request, init?: RequestInit) => {
        sent();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      };
      const pending = failure(deliverWebhook(destination, intent, 1, hanging, { now }));
      // Signing is asynchronous, so the deadline starts only once the request is on its way.
      await inFlight;
      await vi.advanceTimersByTimeAsync(9_999);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).code).toBe("webhook-unreachable");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "http://hooks.example.com/relay",
    "https://10.0.0.5/relay",
    "https://169.254.169.254/latest/meta-data",
    "https://user:pass@hooks.example.com/relay",
  ])("refuses %s without sending anything", async (url) => {
    const fetcher = receiver(200);
    const error = await failure(deliverWebhook({ ...destination, url }, intent, 1, fetcher));
    expect(error.code).toBe("webhook-destination-refused");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses input outside the allowlist without sending anything", async () => {
    const fetcher = receiver(200);
    const error = await failure(
      deliverWebhook(
        destination,
        { ...intent, input: { eventType: "task", fields: { body: "original message" } } },
        1,
        fetcher,
      ),
    );
    expect(error.code).toBe("webhook-invalid-input");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("webhookSignature", () => {
  it("is HMAC-SHA256 over the timestamp, a dot, and the raw body", async () => {
    // Computed outside this codebase: Python's hmac.new(b"a" * 64, b'1730376000.{"a":1}', sha256).
    const expected = "3b4861c277ea092c18c2a011bac70ae15653ee7b6ff163198629640bdea95479";
    const body = new TextEncoder().encode('{"a":1}');
    await expect(webhookSignature(secret, 1730376000, body)).resolves.toBe(expected);
  });
});

describe("loadWebhookDestination", () => {
  const keyring: KekKeyring = { activeVersion: 1, keys: { 1: generateKek() } };
  const configuration: PersistenceConfiguration = {
    environment: "development",
    keyring,
    supabase: {
      serviceRoleKey: "sb_secret_synthetic_backend_key_12345",
      url: "https://supabase.example.test",
    },
  };

  async function row(
    credential: Record<string, unknown>,
    metadata: Record<string, unknown> = { host: "hooks.example.com", signatureVersion: "v1" },
  ) {
    const encrypted = await encryptValue(
      JSON.stringify(credential),
      keyring,
      connectionCredentialEncryptionContext(userId, connectionId),
    );
    return {
      credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
      credential_nonce: base64ToPostgresBytea(encrypted.nonce),
      wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
      wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
      key_version: encrypted.keyVersion,
      encryption_environment: "development",
      metadata,
    };
  }

  function database(rows: unknown[], requests: string[] = []) {
    return (input: string | URL | Request) => {
      requests.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(Response.json(rows));
    };
  }

  it("loads the destination for one active webhook connection of this tenant", async () => {
    const requests: string[] = [];
    const destinationRow = await row({ secret, url: "https://hooks.example.com/t/token" });
    await expect(
      loadWebhookDestination(
        configuration,
        userId,
        connectionId,
        database([destinationRow], requests),
        {
          now,
        },
      ),
    ).resolves.toEqual({ secrets: [secret], url: "https://hooks.example.com/t/token" });
    const query = new URL(requests[0] ?? "").searchParams;
    expect(query.get("id")).toBe(`eq.${connectionId}`);
    expect(query.get("user_id")).toBe(`eq.${userId}`);
    expect(query.get("provider")).toBe("eq.webhook");
    expect(query.get("status")).toBe("eq.active");
  });

  it("adds the previous secret only while its overlap window is open", async () => {
    const credential = { previousSecret, secret, url: "https://hooks.example.com/relay" };
    const open = await row(credential, {
      host: "hooks.example.com",
      previousSecretExpiresAt: "2026-11-01T00:00:00.000Z",
      signatureVersion: "v1",
    });
    const closed = await row(credential, {
      host: "hooks.example.com",
      previousSecretExpiresAt: "2026-10-31T11:00:00.000Z",
      signatureVersion: "v1",
    });
    const unrecorded = await row(credential);

    const load = (value: unknown) =>
      loadWebhookDestination(configuration, userId, connectionId, database([value]), { now });
    expect((await load(open)).secrets).toEqual([secret, previousSecret]);
    expect((await load(closed)).secrets).toEqual([secret]);
    expect((await load(unrecorded)).secrets).toEqual([secret]);
  });

  it.each([
    ["no row", () => Promise.resolve([])],
    [
      "two rows",
      async () => [
        await row({ secret, url: "https://a.test" }),
        await row({ secret, url: "https://b.test" }),
      ],
    ],
    [
      "another environment's row",
      async () => [
        { ...(await row({ secret, url: "https://a.test" })), encryption_environment: "production" },
      ],
    ],
    ["a credential that is not webhook-shaped", async () => [await row({ apiKey: "sk-test" })]],
    [
      "metadata that carries the URL",
      async () => [
        await row(
          { secret, url: "https://a.test" },
          { host: "a.test", signatureVersion: "v1", url: "https://a.test" },
        ),
      ],
    ],
  ])("fails closed on %s", async (_name, rows) => {
    const error = await failure(
      loadWebhookDestination(configuration, userId, connectionId, database(await rows()), { now }),
    );
    expect(error.code).toBe("webhook-credential-unavailable");
  });

  it("fails closed on a credential encrypted for another connection", async () => {
    const other = await row({ secret, url: "https://a.test" });
    const error = await failure(
      loadWebhookDestination(
        configuration,
        userId,
        "00000000-0000-4000-8000-000000000000",
        database([other]),
        { now },
      ),
    );
    expect(error.code).toBe("webhook-credential-unavailable");
    expect(error.cause).toBeUndefined();
  });
});
