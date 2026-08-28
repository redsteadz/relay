import { openAiCredentialSubmitRequestSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import {
  CredentialConflictError,
  CredentialNotFoundError,
  CredentialRejectedError,
  CredentialValidationUnavailableError,
  getOpenAiCredentialStatus,
  loadOpenAiEnv,
  revokeOpenAiCredential,
  rotateOpenAiCredential,
  submitOpenAiCredential,
} from "../../../../lib/openai-credentials";

function unconfigured(): Response {
  return Response.json(
    { error: { code: "openai_not_configured", message: "OpenAI connector is not configured" } },
    { status: 503 },
  );
}

function parseSubmitBody(value: unknown) {
  return openAiCredentialSubmitRequestSchema.safeParse(value);
}

export async function GET(request: Request) {
  const env = loadOpenAiEnv();
  if (env === null) return unconfigured();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const status = await getOpenAiCredentialStatus(auth.userId, env);
  return Response.json(status, { status: 200 });
}

export async function POST(request: Request) {
  const env = loadOpenAiEnv();
  if (env === null) return unconfigured();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: { code: "invalid_openai_key" } }, { status: 400 });
  }
  const parsed = parseSubmitBody(value);
  if (!parsed.success)
    return Response.json({ error: { code: "invalid_openai_key" } }, { status: 400 });

  try {
    const status = await submitOpenAiCredential(auth.userId, parsed.data.apiKey, env);
    return Response.json(status, { status: 200 });
  } catch (error) {
    if (error instanceof CredentialRejectedError) {
      return Response.json({ error: { code: "openai_key_rejected" } }, { status: 400 });
    }
    if (error instanceof CredentialConflictError) {
      return Response.json({ error: { code: "openai_already_configured" } }, { status: 409 });
    }
    if (error instanceof CredentialValidationUnavailableError) {
      return Response.json({ error: { code: "openai_validation_unavailable" } }, { status: 502 });
    }
    return Response.json({ error: { code: "openai_credential_unavailable" } }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const env = loadOpenAiEnv();
  if (env === null) return unconfigured();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: { code: "invalid_openai_key" } }, { status: 400 });
  }
  const parsed = parseSubmitBody(value);
  if (!parsed.success)
    return Response.json({ error: { code: "invalid_openai_key" } }, { status: 400 });

  try {
    const status = await rotateOpenAiCredential(auth.userId, parsed.data.apiKey, env);
    return Response.json(status, { status: 200 });
  } catch (error) {
    if (error instanceof CredentialRejectedError) {
      return Response.json({ error: { code: "openai_key_rejected" } }, { status: 400 });
    }
    if (error instanceof CredentialNotFoundError) {
      return Response.json({ error: { code: "openai_not_found" } }, { status: 404 });
    }
    if (error instanceof CredentialValidationUnavailableError) {
      return Response.json({ error: { code: "openai_validation_unavailable" } }, { status: 502 });
    }
    return Response.json({ error: { code: "openai_credential_unavailable" } }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const env = loadOpenAiEnv();
  if (env === null) return unconfigured();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  try {
    const result = await revokeOpenAiCredential(auth.userId, env);
    if (!result.revoked) {
      return Response.json({ error: { code: "openai_not_found" } }, { status: 404 });
    }
    return Response.json({ provider: "openai", configured: false }, { status: 200 });
  } catch {
    return Response.json({ error: { code: "openai_credential_unavailable" } }, { status: 503 });
  }
}
