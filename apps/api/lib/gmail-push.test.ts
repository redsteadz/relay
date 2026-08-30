import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from "jose";

import {
  handleGmailPush,
  MAX_GMAIL_PUSH_BODY_BYTES,
  parseVerifiedGmailPush,
  verifyPubSubBearerJwt,
  type GmailPushConfiguration,
} from "./gmail-push";

const configuration: GmailPushConfiguration = {
  audience: "https://relay.example.test/api/connectors/gmail/push",
  serviceAccountEmail: "relay-push@example-project.iam.gserviceaccount.com",
};

let privateKey: CryptoKey;
let wrongPrivateKey: CryptoKey;
let localKeys: JWTVerifyGetKey;

beforeAll(async () => {
  const primary = await generateKeyPair("RS256");
  const wrong = await generateKeyPair("RS256");
  privateKey = primary.privateKey;
  wrongPrivateKey = wrong.privateKey;
  localKeys = createLocalJWKSet({
    keys: [
      { ...(await exportJWK(primary.publicKey)), alg: "RS256", kid: "synthetic-key", use: "sig" },
    ],
  });
});

beforeEach(() => {
  vi.stubEnv("GOOGLE_PUBSUB_AUDIENCE", configuration.audience);
  vi.stubEnv("GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL", configuration.serviceAccountEmail);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Claims = {
  audience?: string;
  email?: string;
  emailVerified?: boolean;
  expiresAt?: number;
  issuer?: string;
  key?: CryptoKey;
};

async function token(overrides: Claims = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: overrides.email ?? configuration.serviceAccountEmail,
    email_verified: overrides.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic-key", typ: "JWT" })
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? configuration.audience)
    .setIssuedAt(now)
    .setExpirationTime(overrides.expiresAt ?? now + 300)
    .sign(overrides.key ?? privateKey);
}

function encodedCursor(mailbox = "mailbox@example.test", historyId = "90071992547409931234") {
  const json = JSON.stringify({ emailAddress: mailbox, historyId });
  const data = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  return {
    message: {
      data,
      messageId: "42",
      message_id: "42",
      publishTime: "2026-08-29T10:00:00Z",
      publish_time: "2026-08-29T10:00:00Z",
    },
    subscription: "projects/synthetic-project/subscriptions/relay-gmail",
  };
}

function pushRequest(bearer: string, body: unknown = encodedCursor(), headers: HeadersInit = {}) {
  return new Request(configuration.audience, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("Pub/Sub bearer JWT verification", () => {
  it("accepts local RS256 signature and exact Google delivery claims", async () => {
    await expect(
      verifyPubSubBearerJwt(await token(), configuration, localKeys),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["issuer", { issuer: "https://issuer.example.test" }],
    ["audience", { audience: `${configuration.audience}/other` }],
    ["expiry", { expiresAt: Math.floor(Date.now() / 1000) - 1 }],
    ["service account", { email: "other@example-project.iam.gserviceaccount.com" }],
    ["verified email", { emailVerified: false }],
  ] satisfies [string, Claims][])("rejects invalid %s", async (_name, overrides) => {
    await expect(
      verifyPubSubBearerJwt(await token(overrides), configuration, localKeys),
    ).rejects.toThrow();
  });

  it("rejects a JWT signed by an untrusted key", async () => {
    await expect(
      verifyPubSubBearerJwt(await token({ key: wrongPrivateKey }), configuration, localKeys),
    ).rejects.toThrow();
  });
});

describe("Gmail Pub/Sub callback", () => {
  function dependencies(
    overrides: Partial<NonNullable<Parameters<typeof handleGmailPush>[1]>> = {},
  ) {
    return {
      parseRequest: parseVerifiedGmailPush,
      publish: vi.fn(() => Promise.resolve(new Response(null, { status: 202 }))),
      verify: (bearer: string, config: GmailPushConfiguration) =>
        verifyPubSubBearerJwt(bearer, config, localKeys),
      ...overrides,
    };
  }

  it("decodes and forwards only verified normalized cursor", async () => {
    const deps = dependencies();
    const response = await handleGmailPush(
      pushRequest(await token(), encodedCursor("Mailbox@Example.test")),
      deps,
    );

    expect(response.status).toBe(204);
    expect(deps.publish).toHaveBeenCalledWith({
      schemaVersion: 1,
      emailAddress: "mailbox@example.test",
      historyId: "90071992547409931234",
    });
  });

  it("rejects mismatched documented Pub/Sub wire aliases", async () => {
    const deps = dependencies();
    const wrapper = encodedCursor();
    const response = await handleGmailPush(
      pushRequest(await token(), {
        ...wrapper,
        message: { ...wrapper.message, message_id: "43" },
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("verifies authentication before invoking any body decoder", async () => {
    const parseRequest = vi.fn(() => Promise.reject(new Error("synthetic decoder must not run")));
    const publish = vi.fn();
    const response = await handleGmailPush(pushRequest("malformed.jwt", "sensitive-push-body"), {
      parseRequest,
      publish,
      verify: vi.fn(() => Promise.reject(new Error("synthetic auth failure"))),
    });

    expect(response.status).toBe(401);
    expect(parseRequest).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    await expect(response.text()).resolves.not.toContain("sensitive-push-body");
  });

  it("fails non-success when verification configuration is missing", async () => {
    vi.stubEnv("GOOGLE_PUBSUB_AUDIENCE", "");
    const verify = vi.fn();
    const response = await handleGmailPush(pushRequest(await token()), {
      ...dependencies(),
      verify,
    });

    expect(response.status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects body from Content-Length before buffering", async () => {
    const request = pushRequest(await token(), encodedCursor(), {
      "content-length": (MAX_GMAIL_PUSH_BODY_BYTES + 1).toString(),
    });
    const deps = dependencies();
    const response = await handleGmailPush(request, deps);

    expect(response.status).toBe(400);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body", async () => {
    const deps = dependencies();
    const response = await handleGmailPush(
      pushRequest(await token(), "x".repeat(MAX_GMAIL_PUSH_BODY_BYTES + 1)),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it.each([
    [404, 409, "gmail_ownership_unresolved"],
    [409, 409, "gmail_ownership_unresolved"],
    [503, 503, "gmail_cursor_not_durable"],
  ])(
    "maps Pipeline status %i to retryable callback failure",
    async (pipelineStatus, status, code) => {
      const response = await handleGmailPush(
        pushRequest(await token()),
        dependencies({
          publish: vi.fn(() => Promise.resolve(new Response(null, { status: pipelineStatus }))),
        }),
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    },
  );

  it("never reflects push, token, mailbox, or provider values in failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveMailbox = "private-mailbox@example.test";
    const sensitiveToken = await token();
    const response = await handleGmailPush(
      pushRequest(sensitiveToken, encodedCursor(sensitiveMailbox)),
      dependencies({
        publish: vi.fn(() => Promise.reject(new Error("provider body private-value"))),
      }),
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain(sensitiveMailbox);
    expect(text).not.toContain(sensitiveToken);
    expect(text).not.toContain("private-value");
    expect(errorLog).toHaveBeenCalledTimes(1);
    const serializedLog = String(errorLog.mock.calls[0]?.[0]);
    expect(serializedLog).toContain("connector.push_publication_failed");
    expect(serializedLog).not.toContain(sensitiveMailbox);
    expect(serializedLog).not.toContain(sensitiveToken);
    expect(serializedLog).not.toContain("private-value");
  });
});
