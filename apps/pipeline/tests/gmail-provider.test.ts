import { describe, expect, it, vi } from "vitest";

import {
  createGmailWatch,
  fetchCanonicalGmailEnvelope,
  GMAIL_WATCH_EXPIRATION_TOLERANCE_MS,
  GMAIL_WATCH_MAX_LIFETIME_MS,
  gmailEnvelopeId,
  listGmailHistoryPage,
  MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES,
  readGmailProviderConfiguration,
  refreshGmailAccessToken,
  revokeGoogleRefreshToken,
  stopGmailWatch,
  type GmailProviderConfiguration,
} from "../src/gmail-provider";
import type { Env } from "../src/env";

const configuration: GmailProviderConfiguration = {
  clientId: "synthetic-client-id",
  clientSecret: "synthetic-client-secret",
  pubsubRetentionSeconds: 604_800,
  topicName: "projects/synthetic-project/topics/relay-gmail",
};
const connectionId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";

function interruptedResponse(): Response {
  return new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(new Error("synthetic response interruption"));
      },
    }),
  );
}

describe("Gmail provider client", () => {
  it("requires configured Pub/Sub retention inside provider bounds", () => {
    const env = {
      GOOGLE_CLIENT_ID: configuration.clientId,
      GOOGLE_CLIENT_SECRET: configuration.clientSecret,
      GOOGLE_GMAIL_PUBSUB_TOPIC: configuration.topicName,
      GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS: "604800",
    } as Env;

    expect(readGmailProviderConfiguration(env)).toEqual(configuration);
    expect(() =>
      readGmailProviderConfiguration({
        ...env,
        GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS: "599",
      }),
    ).toThrow("Gmail provider operation failed");
  });

  it("refreshes access token with fixed bounded response", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ access_token: "synthetic-access" })),
    );

    await expect(
      refreshGmailAccessToken("synthetic-refresh", configuration, fetcher),
    ).resolves.toBe("synthetic-access");
    expect(fetcher).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("classifies invalid_grant as completed provider revocation but retries other token errors", async () => {
    await expect(
      refreshGmailAccessToken(
        "synthetic-refresh",
        configuration,
        vi.fn(() => Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }))),
      ),
    ).rejects.toMatchObject({ code: "grant-revoked" });
    await expect(
      refreshGmailAccessToken(
        "synthetic-refresh",
        configuration,
        vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("returns one bounded History page and validates opaque continuation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          history: [{ id: "101", messagesAdded: [{ message: { id: "m-1" } }] }],
          historyId: "105",
          nextPageToken: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          history: [
            {
              id: "104",
              messagesAdded: [{ message: { id: "m-1" } }, { message: { id: "m-2" } }],
            },
          ],
          historyId: "110",
        }),
      );

    await expect(listGmailHistoryPage("access", "100", undefined, fetcher)).resolves.toEqual({
      latestHistoryId: "105",
      messageIds: ["m-1"],
      nextPageToken: "page-2",
    });
    await expect(listGmailHistoryPage("access", "100", "page-2", fetcher)).resolves.toEqual({
      latestHistoryId: "110",
      messageIds: ["m-1", "m-2"],
    });
    expect(new URL(fetcher.mock.calls[1]![0] as string).searchParams.get("pageToken")).toBe(
      "page-2",
    );
  });

  it("maps stale cursor 404 to fixed state code", async () => {
    await expect(
      listGmailHistoryPage(
        "access",
        "100",
        undefined,
        vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
      ),
    ).rejects.toMatchObject({ code: "stale-history", message: "Gmail provider operation failed" });
  });

  it("accepts more than one hundred changed messages in one bounded History record", async () => {
    const messageIds = Array.from({ length: 205 }, (_, index) => `message-${index + 1}`);

    await expect(
      listGmailHistoryPage(
        "access",
        "100",
        undefined,
        vi.fn(() =>
          Promise.resolve(
            Response.json({
              history: [
                {
                  id: "200",
                  messagesAdded: messageIds.map((id) => ({ message: { id } })),
                },
              ],
              historyId: "200",
            }),
          ),
        ),
      ),
    ).resolves.toMatchObject({ latestHistoryId: "200", messageIds: [...messageIds].sort() });
  });

  it("canonicalizes deterministic bounded envelope without attachment download", async () => {
    const text = "x".repeat(60_000);
    const body = btoa(text).replace(/\+/g, "-").replace(/\//g, "_");
    const fetcher = vi.fn((_input: string, _init?: RequestInit) => {
      void _input;
      void _init;
      return Promise.resolve(
        Response.json({
          id: "message-1",
          threadId: "thread-1",
          internalDate: "1787994000000",
          labelIds: ["STARRED", "INBOX", "INBOX"],
          payload: {
            mimeType: "multipart/mixed",
            filename: "",
            headers: [
              { name: "From", value: "sender@example.test" },
              { name: "Subject", value: "Synthetic subject" },
            ],
            body: { size: 0 },
            parts: [
              {
                mimeType: "text/plain",
                filename: "",
                headers: [],
                body: { data: body, size: 60_000 },
              },
              {
                mimeType: "application/pdf",
                filename: "synthetic.pdf",
                headers: [],
                body: { attachmentId: "attachment-never-fetched", size: 1_000_000 },
              },
            ],
          },
        }),
      );
    });

    const first = await fetchCanonicalGmailEnvelope("access", connectionId, "message-1", fetcher);
    const secondId = await gmailEnvelopeId(connectionId, "message-1");

    expect(first?.id).toBe(secondId);
    expect(first?.source).toEqual({
      kind: "gmail",
      externalId: "message-1",
      accountId: connectionId,
    });
    expect(new TextEncoder().encode(first?.body).byteLength).toBeLessThanOrEqual(48_000);
    expect(first?.attributes).toMatchObject({
      gmailBodyBytes: 60_000,
      gmailBodyTruncated: true,
      gmailLabelIds: ["INBOX", "STARRED"],
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("classifies provider response declared above fixed bound as terminal", async () => {
    await expect(
      fetchCanonicalGmailEnvelope(
        "access",
        connectionId,
        "message-1",
        vi.fn(() =>
          Promise.resolve(
            new Response("{}", {
              headers: { "content-length": "1000001" },
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("keeps provider 5xx message failures transient", async () => {
    await expect(
      fetchCanonicalGmailEnvelope(
        "access",
        connectionId,
        "message-1",
        vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("keeps interrupted message and History response streams transient", async () => {
    await expect(
      fetchCanonicalGmailEnvelope(
        "access",
        connectionId,
        "message-1",
        vi.fn(() => Promise.resolve(interruptedResponse())),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      listGmailHistoryPage(
        "access",
        "100",
        undefined,
        vi.fn(() => Promise.resolve(interruptedResponse())),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("truncates excess headers instead of rejecting an otherwise canonical message", async () => {
    const headers = [
      { name: "From", value: "sender@example.test" },
      { name: "Subject", value: "Synthetic subject" },
      ...Array.from({ length: 199 }, (_, index) => ({ name: `X-Synthetic-${index}`, value: "x" })),
    ];
    const envelope = await fetchCanonicalGmailEnvelope(
      "access",
      connectionId,
      "message-1",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            id: "message-1",
            threadId: "thread-1",
            internalDate: "1787994000000",
            payload: {
              mimeType: "text/plain",
              filename: "",
              headers,
              body: { data: btoa("synthetic"), size: 9 },
            },
          }),
        ),
      ),
    );

    expect(envelope).toMatchObject({ sender: "sender@example.test", subject: "Synthetic subject" });
    expect(envelope?.attributes).toMatchObject({
      gmailSenderTruncated: true,
      gmailSubjectTruncated: true,
    });
  });

  it("truncates JSON-expanding source text to explicit serialized Queue plaintext budget", async () => {
    const source = "\u0000".repeat(48_000);
    const envelope = await fetchCanonicalGmailEnvelope(
      "access",
      connectionId,
      "message-1",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            id: "message-1",
            threadId: "thread-1",
            internalDate: "1787994000000",
            labelIds: Array.from({ length: 100 }, (_, index) => `label-${index}`),
            payload: {
              mimeType: "text/plain",
              filename: "",
              headers: [],
              body: { data: btoa(source), size: 48_000 },
            },
          }),
        ),
      ),
    );

    expect(new TextEncoder().encode(JSON.stringify(envelope)).byteLength).toBeLessThanOrEqual(
      MAX_GMAIL_ENVELOPE_SERIALIZED_BYTES,
    );
    expect(envelope?.body?.length).toBeLessThan(source.length);
    expect(envelope?.attributes).toMatchObject({
      gmailBodyTruncated: true,
      gmailQueueTruncated: true,
    });
  });

  it("marks body truncated when a later plain-text part omits inline data", async () => {
    const inline = btoa("retained text").replace(/\+/g, "-").replace(/\//g, "_");
    const envelope = await fetchCanonicalGmailEnvelope(
      "access",
      connectionId,
      "message-1",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            id: "message-1",
            threadId: "thread-1",
            internalDate: "1787994000000",
            payload: {
              mimeType: "multipart/alternative",
              filename: "",
              body: { size: 0 },
              parts: [
                {
                  mimeType: "text/plain",
                  filename: "",
                  body: { data: inline, size: 13 },
                },
                {
                  mimeType: "text/plain",
                  filename: "",
                  body: { attachmentId: "omitted-text-part", size: 3 },
                },
              ],
            },
          }),
        ),
      ),
    );

    expect(envelope?.body).toBe("retained text");
    expect(envelope?.attributes).toMatchObject({
      gmailBodyBytes: 13,
      gmailBodyTruncated: true,
    });
  });

  it("marks named plain-text content omitted even when Gmail returns inline data", async () => {
    const namedText = btoa("omitted named text").replace(/\+/g, "-").replace(/\//g, "_");
    const envelope = await fetchCanonicalGmailEnvelope(
      "access",
      connectionId,
      "message-1",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            id: "message-1",
            threadId: "thread-1",
            internalDate: "1787994000000",
            payload: {
              mimeType: "multipart/mixed",
              filename: "",
              body: { size: 0 },
              parts: [
                {
                  mimeType: "text/plain",
                  filename: "notes.txt",
                  body: { data: namedText, size: 18 },
                },
              ],
            },
          }),
        ),
      ),
    );

    expect(envelope?.body).toBeUndefined();
    expect(envelope?.attributes).toMatchObject({
      gmailBodyBytes: 0,
      gmailBodyTruncated: true,
    });
  });

  it("renews watch with configured topic and decimal baseline", async () => {
    const fetcher = vi.fn((_input: string, _init?: RequestInit) => {
      void _input;
      void _init;
      return Promise.resolve(
        Response.json({ historyId: "90071992547409931234", expiration: "1788602400000" }),
      );
    });

    const watch = await createGmailWatch(
      "access",
      configuration,
      fetcher,
      undefined,
      Date.parse("2026-08-29T10:00:00Z"),
    );

    expect(watch.historyId).toBe("90071992547409931234");
    const request = fetcher.mock.calls[0]![1];
    expect(request?.body).toBe(JSON.stringify({ topicName: configuration.topicName }));
  });

  it("keeps 408 and 5xx watch outcomes ambiguous but classifies bounded rejection statuses", async () => {
    for (const status of [408, 500, 503]) {
      await expect(
        createGmailWatch(
          "access",
          configuration,
          vi.fn(() => Promise.resolve(new Response(null, { status }))),
        ),
      ).rejects.toMatchObject({ code: "unavailable" });
    }
    for (const status of [400, 401, 403, 404, 429]) {
      await expect(
        createGmailWatch(
          "access",
          configuration,
          vi.fn(() => Promise.resolve(new Response(null, { status }))),
        ),
      ).rejects.toMatchObject({ code: "request-rejected" });
    }
    await expect(
      createGmailWatch(
        "access",
        configuration,
        vi.fn(() => Promise.resolve(interruptedResponse())),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("accepts watch expiration at seven-day tolerance and rejects beyond it", async () => {
    const now = Date.parse("2026-08-29T10:00:00Z");
    const maximum = now + GMAIL_WATCH_MAX_LIFETIME_MS + GMAIL_WATCH_EXPIRATION_TOLERANCE_MS;
    const response = (expiration: number) =>
      vi.fn(() =>
        Promise.resolve(Response.json({ historyId: "100", expiration: expiration.toString() })),
      );

    await expect(
      createGmailWatch("access", configuration, response(maximum), undefined, now),
    ).resolves.toMatchObject({ expiration: new Date(maximum).toISOString() });
    await expect(
      createGmailWatch("access", configuration, response(maximum + 1), undefined, now),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("stops Gmail delivery and treats already-invalid refresh token as revoked", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ error: "invalid_token" }, { status: 400 }));

    await expect(stopGmailWatch("access", fetcher)).resolves.toBeUndefined();
    await expect(revokeGoogleRefreshToken("synthetic-refresh", fetcher)).resolves.toBeUndefined();

    expect(fetcher.mock.calls[0]).toEqual([
      "https://gmail.googleapis.com/gmail/v1/users/me/stop",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer access" },
      }),
    ]);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://oauth2.googleapis.com/revoke");
  });
});
