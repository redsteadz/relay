import {
  accountDeletionResponseSchema,
  openAiCredentialStatusSchema,
  privacyDisclosuresResponseSchema,
  privacyOverviewResponseSchema,
  privacyPurgeResponseSchema,
  type AccountDeletionResponse,
  type OpenAiCredentialStatus,
  type OpenAiCredentialSubmitRequest,
  type PrivacyDisclosure,
  type PrivacyOverviewResponse,
  type PrivacyPurgeResponse,
} from "@relay/contracts";

import { RelayApiError, requestRelayApi } from "@/lib/relay-api";
import { logMobileError } from "@/lib/observability";

type RuntimeSchema<T> = {
  safeParse: (value: unknown) => { data: T; success: true } | { error?: unknown; success: false };
};

function parseResponse<T>(schema: RuntimeSchema<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const error = new RelayApiError("malformed-response", {
      cause: parsed.error ?? new Error("Response contract validation failed"),
      operation,
    });
    logMobileError("integration.response_contract_invalid", error, {
      code: error.code,
      integration: "relay-api",
      operation,
    });
    throw error;
  }
  return parsed.data;
}

export async function getPrivacyOverview(accessToken: string): Promise<PrivacyOverviewResponse> {
  return parseResponse(
    privacyOverviewResponseSchema,
    await requestRelayApi(accessToken, "/api/privacy"),
    "getPrivacyOverview",
  );
}

export async function purgeRawPayloads(accessToken: string): Promise<PrivacyPurgeResponse> {
  return parseResponse(
    privacyPurgeResponseSchema,
    await requestRelayApi(accessToken, "/api/privacy/raw-payloads", { method: "DELETE" }),
    "purgeRawPayloads",
  );
}

export async function getDisclosureHistory(
  accessToken: string,
  limit = 100,
): Promise<PrivacyDisclosure[]> {
  const response = parseResponse(
    privacyDisclosuresResponseSchema,
    await requestRelayApi(accessToken, `/api/privacy/disclosures?limit=${limit.toString()}`),
    "getDisclosureHistory",
  );
  return response.disclosures;
}

export async function getOpenAiStatus(accessToken: string): Promise<OpenAiCredentialStatus> {
  return parseResponse(
    openAiCredentialStatusSchema,
    await requestRelayApi(accessToken, "/api/connectors/openai"),
    "getOpenAiStatus",
  );
}

/**
 * Stores a first key for this account.
 *
 * The request body is the only place key material appears. It is never read back: the status
 * response carries the endpoint and validation metadata, and Relay has no route that returns a
 * stored key.
 */
export async function submitOpenAiKey(
  accessToken: string,
  request: OpenAiCredentialSubmitRequest,
): Promise<OpenAiCredentialStatus> {
  return parseResponse(
    openAiCredentialStatusSchema,
    await requestRelayApi(accessToken, "/api/connectors/openai", {
      body: request,
      method: "POST",
    }),
    "submitOpenAiKey",
  );
}

/** Replaces the stored key, and the endpoint with it when the request names one. */
export async function rotateOpenAiKey(
  accessToken: string,
  request: OpenAiCredentialSubmitRequest,
): Promise<OpenAiCredentialStatus> {
  return parseResponse(
    openAiCredentialStatusSchema,
    await requestRelayApi(accessToken, "/api/connectors/openai", {
      body: request,
      method: "PATCH",
    }),
    "rotateOpenAiKey",
  );
}

export async function revokeOpenAiKey(accessToken: string): Promise<OpenAiCredentialStatus> {
  return parseResponse(
    openAiCredentialStatusSchema,
    await requestRelayApi(accessToken, "/api/connectors/openai", { method: "DELETE" }),
    "revokeOpenAiKey",
  );
}

export async function deleteRelayAccount(accessToken: string): Promise<AccountDeletionResponse> {
  return parseResponse(
    accountDeletionResponseSchema,
    await requestRelayApi(accessToken, "/api/privacy/account", {
      body: { confirm: "delete my account" },
      method: "DELETE",
    }),
    "deleteRelayAccount",
  );
}
