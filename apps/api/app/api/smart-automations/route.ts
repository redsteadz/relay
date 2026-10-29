import { createClient } from "@supabase/supabase-js";
import { smartCommandSchema, smartOverviewSchema } from "@relay/contracts";
import { authenticateRequest } from "../../../lib/auth";
import { publishSmartAutomation } from "../../../lib/pipeline";
import { apiRequestId, loggedErrorResponse } from "../../../lib/observability";
import { readBoundedJson } from "../../../lib/gmail";

async function handle(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;
  if (process.env.RELAY_SMART_GOOGLE_ENABLED !== "true")
    return Response.json(
      {
        error: {
          code: "smart_not_configured",
          message: "Smart Automations is not enabled in this environment.",
        },
      },
      { status: 503 },
    );
  try {
    const command =
      request.method === "POST"
        ? smartCommandSchema.safeParse(
            await readBoundedJson(
              new Response(request.body, { headers: request.headers }),
              65_536,
            ).catch(() => undefined),
          )
        : undefined;
    if (command !== undefined && !command.success)
      return Response.json(
        { error: { code: "invalid_request", message: "Invalid automation request." } },
        { status: 400 },
      );
    const decision = command?.success ? command.data : undefined;
    if (decision?.type === "approve" || decision?.type === "cancel" || decision?.type === "retry") {
      if (auth.accessToken === undefined)
        return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        {
          global: { headers: { authorization: `Bearer ${auth.accessToken}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const { error } = await client.rpc(
        decision.type === "retry" ? "retry_smart_action_v1" : "decide_action_run",
        decision.type === "retry"
          ? { p_run_id: decision.receiptId }
          : {
              p_action_run_id: decision.receiptId,
              p_decision: decision.type === "approve" ? "approve" : "cancel",
            },
      );
      if (error !== null) throw error;
    }
    const response = await publishSmartAutomation(
      {
        userId: auth.userId,
        ...(decision !== undefined && !["approve", "cancel", "retry"].includes(decision.type)
          ? { command: decision }
          : {}),
      },
      apiRequestId(request),
    );
    if (!response.ok)
      return Response.json(
        { error: { code: "smart_unavailable", message: "Could not update automations." } },
        { status: response.status === 409 ? 409 : 503 },
      );
    return Response.json(smartOverviewSchema.parse(await response.json()), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error: unknown) {
    return loggedErrorResponse(
      request,
      error,
      {
        code: "SMART_REQUEST_FAILED",
        event: "smart.request_failed",
        integration: "relay-pipeline",
        operation: "smartAutomations",
      },
      Response.json(
        { error: { code: "smart_request_failed", message: "Could not apply that change." } },
        { status: 409 },
      ),
    );
  }
}
export const GET = handle;
export const POST = handle;
