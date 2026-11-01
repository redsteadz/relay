import { webhookConnectionCreateRequestSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import { loggedErrorResponse } from "../../../../lib/observability";
import {
  WebhookDestinationInvalidError,
  createWebhookConnection,
  loadWebhookEnv,
  unconfiguredWebhook,
  webhookSecretResponse,
} from "../../../../lib/webhook-connections";

export async function POST(request: Request) {
  const env = loadWebhookEnv();
  if (env === null) return unconfiguredWebhook();

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: { code: "invalid_webhook_url" } }, { status: 400 });
  }
  const parsed = webhookConnectionCreateRequestSchema.safeParse(value);
  if (!parsed.success) {
    return Response.json({ error: { code: "invalid_webhook_url" } }, { status: 400 });
  }

  try {
    return webhookSecretResponse(await createWebhookConnection(auth.userId, parsed.data.url, env));
  } catch (error: unknown) {
    if (error instanceof WebhookDestinationInvalidError) {
      return Response.json({ error: { code: "webhook_destination_refused" } }, { status: 400 });
    }
    return loggedErrorResponse(
      request,
      error,
      {
        code: "WEBHOOK_CONNECTION_STORE_FAILED",
        event: "connector.webhook_create_failed",
        integration: "supabase",
        operation: "createWebhookConnection",
      },
      Response.json({ error: { code: "webhook_connection_unavailable" } }, { status: 503 }),
    );
  }
}
