import { webhookConnectionRotateRequestSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../../lib/auth";
import { loggedErrorResponse } from "../../../../../lib/observability";
import {
  WebhookConnectionNotFoundError,
  WebhookRotationConflictError,
  loadWebhookEnv,
  rotateWebhookConnection,
  unconfiguredWebhook,
  webhookSecretResponse,
} from "../../../../../lib/webhook-connections";

export async function POST(request: Request) {
  const env = loadWebhookEnv();
  if (env === null) return unconfiguredWebhook();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: { code: "invalid_webhook_connection" } }, { status: 400 });
  }
  const parsed = webhookConnectionRotateRequestSchema.safeParse(value);
  if (!parsed.success) {
    return Response.json({ error: { code: "invalid_webhook_connection" } }, { status: 400 });
  }

  try {
    return webhookSecretResponse(
      await rotateWebhookConnection(auth.userId, parsed.data.connectionId, env),
    );
  } catch (error: unknown) {
    if (error instanceof WebhookConnectionNotFoundError) {
      return Response.json({ error: { code: "webhook_not_found" } }, { status: 404 });
    }
    if (error instanceof WebhookRotationConflictError) {
      return Response.json({ error: { code: "webhook_rotation_conflict" } }, { status: 409 });
    }
    return loggedErrorResponse(
      request,
      error,
      {
        code: "WEBHOOK_CONNECTION_ROTATE_FAILED",
        event: "connector.webhook_rotate_failed",
        integration: "supabase",
        operation: "rotateWebhookConnection",
      },
      Response.json({ error: { code: "webhook_connection_unavailable" } }, { status: 503 }),
    );
  }
}
