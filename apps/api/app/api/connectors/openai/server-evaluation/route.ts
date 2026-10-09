import { serverSemanticEvaluationRequestSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../../lib/auth";
import { loggedErrorResponse } from "../../../../../lib/observability";
import {
  CredentialNotFoundError,
  loadOpenAiEnv,
  setServerSemanticEvaluation,
} from "../../../../../lib/openai-credentials";

/**
 * Whether Relay's own runtime may use this tenant's key.
 *
 * Its own route rather than another method on `/api/connectors/openai`, because `PATCH` there
 * rotates the credential: a request that validates a key against a provider and a request that flips
 * one boolean have nothing in common but the row they touch, and sharing a method would have meant
 * one body schema covering both.
 *
 * Nothing here checks the Pro entitlement. It lives in RevenueCat and on the device, and no
 * server-side record of it exists until [#201](https://github.com/redsteadz/relay/issues/201) syncs
 * one — so the gate on this control is presentational, and this route is honest about being
 * reachable by any authenticated tenant. Recorded in ADR-0019 rather than left as a surprise.
 */
export async function PUT(request: Request) {
  const env = loadOpenAiEnv();
  if (env === null) {
    return Response.json({ error: { code: "openai_not_configured" } }, { status: 503 });
  }

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    // Malformed client JSON, rejected before any trusted context exists. One of the two documented
    // exceptions to logging a failure.
    return Response.json({ error: { code: "invalid_request" } }, { status: 400 });
  }
  const parsed = serverSemanticEvaluationRequestSchema.safeParse(value);
  if (!parsed.success)
    return Response.json({ error: { code: "invalid_request" } }, { status: 400 });

  try {
    const status = await setServerSemanticEvaluation(auth.userId, parsed.data.enabled, env);
    return Response.json(status, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof CredentialNotFoundError) {
      return Response.json({ error: { code: "openai_not_found" } }, { status: 404 });
    }
    return loggedErrorResponse(
      request,
      error,
      {
        code: "OPENAI_SERVER_EVALUATION_FAILED",
        event: "connector.openai_server_evaluation_failed",
        integration: "supabase",
        operation: "setServerSemanticEvaluation",
      },
      Response.json({ error: { code: "openai_credential_unavailable" } }, { status: 503 }),
    );
  }
}
