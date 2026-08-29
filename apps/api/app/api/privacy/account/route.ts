import {
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  accountDeletionStatusResponseSchema,
} from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import { deleteAccount, getAccountDeletionStatus, loadPrivacyEnv } from "../../../../lib/privacy";

function notConfigured() {
  return Response.json(
    { error: { code: "privacy_not_configured", message: "Privacy controls are not configured" } },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const env = loadPrivacyEnv();
  if (env === null) return notConfigured();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  try {
    const deletion = await getAccountDeletionStatus(auth.userId, env);
    return Response.json(accountDeletionStatusResponseSchema.parse({ deletion }));
  } catch {
    return Response.json(
      { error: { code: "privacy_unavailable", message: "Deletion status unavailable" } },
      { status: 503 },
    );
  }
}

/**
 * Irreversible. Requires an explicit confirmation field so a bare or mistaken call cannot delete an
 * account: strong confirmation, but a single deliberate step rather than a coercive flow.
 */
export async function DELETE(request: Request) {
  const env = loadPrivacyEnv();
  if (env === null) return notConfigured();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_request", message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }

  if (!accountDeletionRequestSchema.safeParse(body).success) {
    return Response.json(
      {
        error: {
          code: "confirmation_required",
          message: 'Set confirm to "delete my account" to delete this account',
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await deleteAccount(auth.userId, env);
    return Response.json(
      accountDeletionResponseSchema.parse({
        deleted: true,
        deletion: result.status,
        failedRevocations: result.failedRevocations,
        revokedCredentials: result.revokedCredentials,
      }),
    );
  } catch {
    // The deletion is resumable: the same call can be retried and each step is idempotent.
    return Response.json(
      { error: { code: "deletion_failed", message: "Account deletion did not complete" } },
      { status: 503 },
    );
  }
}
