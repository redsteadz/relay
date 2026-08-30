import {
  accountDeletionResponseSchema,
  openAiCredentialStatusSchema,
  privacyDisclosuresResponseSchema,
  privacyOverviewResponseSchema,
  privacyPurgeResponseSchema,
  type AccountDeletionResponse,
  type OpenAiCredentialStatus,
  type PrivacyDisclosure,
  type PrivacyOverviewResponse,
  type PrivacyPurgeResponse,
} from "@relay/contracts";

import { RelayApiError, requestRelayApi } from "@/lib/relay-api";

type RuntimeSchema<T> = {
  safeParse: (value: unknown) => { data: T; success: true } | { success: false };
};

function parseResponse<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RelayApiError("unavailable");
  return parsed.data;
}

export async function getPrivacyOverview(accessToken: string): Promise<PrivacyOverviewResponse> {
  return parseResponse(
    privacyOverviewResponseSchema,
    await requestRelayApi(accessToken, "/api/privacy"),
  );
}

export async function purgeRawPayloads(accessToken: string): Promise<PrivacyPurgeResponse> {
  return parseResponse(
    privacyPurgeResponseSchema,
    await requestRelayApi(accessToken, "/api/privacy/raw-payloads", { method: "DELETE" }),
  );
}

export async function getDisclosureHistory(
  accessToken: string,
  limit = 100,
): Promise<PrivacyDisclosure[]> {
  const response = parseResponse(
    privacyDisclosuresResponseSchema,
    await requestRelayApi(accessToken, `/api/privacy/disclosures?limit=${limit.toString()}`),
  );
  return response.disclosures;
}

export async function getOpenAiStatus(accessToken: string): Promise<OpenAiCredentialStatus> {
  return parseResponse(
    openAiCredentialStatusSchema,
    await requestRelayApi(accessToken, "/api/connectors/openai"),
  );
}

export async function revokeOpenAiKey(accessToken: string): Promise<OpenAiCredentialStatus> {
  return parseResponse(
    openAiCredentialStatusSchema,
    await requestRelayApi(accessToken, "/api/connectors/openai", { method: "DELETE" }),
  );
}

export async function deleteRelayAccount(accessToken: string): Promise<AccountDeletionResponse> {
  return parseResponse(
    accountDeletionResponseSchema,
    await requestRelayApi(accessToken, "/api/privacy/account", {
      body: { confirm: "delete my account" },
      method: "DELETE",
    }),
  );
}
