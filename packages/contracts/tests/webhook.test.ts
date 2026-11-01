import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_ACTION_INPUT_KEYS,
  WEBHOOK_EVENT_FIELDS,
  actionRunFailureSchema,
  actionRunInputSchema,
  webhookActionInputSchema,
  webhookConnectionMetadataSchema,
  webhookCredentialSchema,
  webhookDeliveryErrorCodeSchema,
  webhookEnvelopeSchema,
  webhookInputTemplateSchema,
} from "../src/index.js";

const SECRET = "a".repeat(64);

describe("webhookInputTemplateSchema", () => {
  it("accepts a selection from the allowlist", () => {
    expect(webhookInputTemplateSchema.parse({ fields: ["title", "dueAt"] })).toEqual({
      fields: ["title", "dueAt"],
    });
  });

  it.each([
    ["an empty selection", { fields: [] }],
    ["a repeated field", { fields: ["title", "title"] }],
    ["a raw source field", { fields: ["body"] }],
    ["the sender", { fields: ["sender"] }],
    ["the event kind, which always travels as eventType", { fields: ["kind"] }],
    ["a template that tries to set the URL", { fields: ["title"], url: "https://example.com" }],
    ["a template that tries to set a header", { fields: ["title"], headers: { a: "b" } }],
  ])("refuses %s", (_name, value) => {
    expect(webhookInputTemplateSchema.safeParse(value).success).toBe(false);
  });

  it("allowlists no field the action ledger forbids", () => {
    for (const field of WEBHOOK_EVENT_FIELDS) {
      expect(FORBIDDEN_ACTION_INPUT_KEYS).not.toContain(field);
    }
  });
});

describe("webhookActionInputSchema", () => {
  const input = {
    eventType: "task",
    fields: { title: "Review order", dueAt: "2026-11-02T09:00:00Z" },
  };

  it("is a valid action run input", () => {
    expect(webhookActionInputSchema.parse(input)).toEqual(input);
    expect(actionRunInputSchema.safeParse(input).success).toBe(true);
  });

  it("refuses a field outside the allowlist", () => {
    expect(
      webhookActionInputSchema.safeParse({ ...input, fields: { body: "hello" } }).success,
    ).toBe(false);
  });
});

describe("webhookEnvelopeSchema", () => {
  const envelope = {
    version: 1,
    actionId: "6f98ad81-f071-418b-a426-8c8c9f627161",
    eventType: "task",
    attempt: 1,
    fields: { title: "Review order" },
  };

  it("accepts the documented body", () => {
    expect(webhookEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it.each([
    ["attempt zero", { ...envelope, attempt: 0 }],
    ["another version", { ...envelope, version: 2 }],
    ["an extra key", { ...envelope, url: "https://example.com" }],
  ])("refuses %s", (_name, value) => {
    expect(webhookEnvelopeSchema.safeParse(value).success).toBe(false);
  });
});

describe("webhookCredentialSchema", () => {
  it("accepts a secret, an optional previous one, and a URL", () => {
    const credential = { previousSecret: "b".repeat(64), secret: SECRET, url: "https://x.test/a" };
    expect(webhookCredentialSchema.parse(credential)).toEqual(credential);
  });

  it.each([
    ["a short secret", { secret: "ab", url: "https://x.test" }],
    ["an uppercase secret", { secret: "A".repeat(64), url: "https://x.test" }],
    ["an extra key", { secret: SECRET, url: "https://x.test", token: "t" }],
  ])("refuses %s", (_name, value) => {
    expect(webhookCredentialSchema.safeParse(value).success).toBe(false);
  });
});

describe("webhookConnectionMetadataSchema", () => {
  it("holds no URL, only the host", () => {
    expect(
      webhookConnectionMetadataSchema.safeParse({
        host: "hooks.example.com",
        signatureVersion: "v1",
        url: "https://hooks.example.com/t/secret-token",
      }).success,
    ).toBe(false);
  });
});

describe("webhookDeliveryErrorCodeSchema", () => {
  it.each(webhookDeliveryErrorCodeSchema.options)(
    "%s is a valid action run failure code",
    (errorCode) => {
      expect(
        actionRunFailureSchema.safeParse({
          actionRunId: "6f98ad81-f071-418b-a426-8c8c9f627161",
          errorCode,
          retryable: false,
          userId: "cbf55db3-fabe-460d-af9e-68f49cfcaa78",
          workflowInstanceId: "workflow-1",
        }).success,
      ).toBe(true);
    },
  );
});
