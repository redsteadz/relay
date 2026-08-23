import { describe, expect, it } from "vitest";

import type { ActionIntent } from "@relay/contracts";

import { nextcloudBudgetTransactionRequest } from "../src/providers";

describe("nextcloudBudgetTransactionRequest", () => {
  it("uses Relay action id for provider idempotency", async () => {
    const intent: ActionIntent = {
      id: "6f98ad81-f071-418b-a426-8c8c9f627161",
      eventId: "cbf55db3-fabe-460d-af9e-68f49cfcaa78",
      ruleId: "23868f8c-0639-42ad-9499-04d98e986380",
      provider: "nextcloud-budget",
      approval: "approved",
      operation: "create-transaction",
      input: {
        accountId: 36,
        amount: "14.20",
        date: "2026-08-24",
        merchant: "North Station",
        type: "debit",
      },
      createdAt: "2026-08-24T12:41:00Z",
    };

    const request = nextcloudBudgetTransactionRequest(
      "https://cloud.example.test/",
      "relay-user",
      "app-password",
      intent,
    );
    const form = new URLSearchParams(await request.text());

    expect(request.url).toBe(
      "https://cloud.example.test/ocs/v2.php/apps/budget/api/v1/transactions",
    );
    expect(request.headers.get("ocs-apirequest")).toBe("true");
    expect(form.get("idempotency_key")).toBe(intent.id);
    expect(form.get("amount")).toBe("14.20");
  });

  it("rejects numeric money before precision can be lost", () => {
    const intent: ActionIntent = {
      id: "6f98ad81-f071-418b-a426-8c8c9f627161",
      eventId: "cbf55db3-fabe-460d-af9e-68f49cfcaa78",
      ruleId: "23868f8c-0639-42ad-9499-04d98e986380",
      provider: "nextcloud-budget",
      approval: "approved",
      operation: "create-transaction",
      input: {
        accountId: 36,
        amount: 14.2,
        date: "2026-08-24",
        merchant: "Station",
        type: "debit",
      },
      createdAt: "2026-08-24T12:41:00Z",
    };

    expect(() =>
      nextcloudBudgetTransactionRequest("https://cloud.example.test", "user", "secret", intent),
    ).toThrow("decimal string");
  });

  it("rejects private Nextcloud origins", () => {
    const intent: ActionIntent = {
      id: "6f98ad81-f071-418b-a426-8c8c9f627161",
      eventId: "cbf55db3-fabe-460d-af9e-68f49cfcaa78",
      ruleId: "23868f8c-0639-42ad-9499-04d98e986380",
      provider: "nextcloud-budget",
      approval: "approved",
      operation: "create-transaction",
      input: {
        accountId: 36,
        amount: "14.20",
        date: "2026-08-24",
        merchant: "Station",
        type: "debit",
      },
      createdAt: "2026-08-24T12:41:00Z",
    };

    expect(() =>
      nextcloudBudgetTransactionRequest("http://127.0.0.1", "user", "secret", intent),
    ).toThrow("public HTTPS");
  });
});
