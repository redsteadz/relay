import { TenantCoordinator } from "./coordinator";
import type { Env, IngressQueueMessage } from "./env";
import { handlePipelineRequest } from "./http";
import { runScheduledMaintenance } from "./maintenance";
import { logPipelineError } from "./observability";
import { processIngressQueue } from "./queue";

export { TenantCoordinator };

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handlePipelineRequest(request, env);
    } catch (error: unknown) {
      logPipelineError(env, "http.request_failed", error, {
        code: "PIPELINE_REQUEST_FAILED",
        integration: "relay-pipeline",
        operation: "handlePipelineRequest",
        requestId: request.headers.get("x-relay-request-id") ?? undefined,
      });
      return Response.json({ error: "pipeline-unavailable" }, { status: 503 });
    }
  },

  async queue(batch, env): Promise<void> {
    try {
      await processIngressQueue(batch, env);
    } catch (error: unknown) {
      logPipelineError(env, "queue.batch_failed", error, {
        code: "QUEUE_BATCH_FAILED",
        integration: "cloudflare-queue",
        operation: "processIngressQueue",
      });
      throw error;
    }
  },

  async scheduled(_controller, env): Promise<void> {
    try {
      await runScheduledMaintenance(env);
    } catch (error: unknown) {
      logPipelineError(env, "background.scheduled_maintenance_failed", error, {
        code: "SCHEDULED_MAINTENANCE_FAILED",
        integration: "relay-pipeline",
        operation: "runScheduledMaintenance",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<Env, IngressQueueMessage>;
