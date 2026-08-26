import { TenantCoordinator } from "./coordinator";
import type { Env, IngressQueueMessage } from "./env";
import { handlePipelineRequest } from "./http";
import { runScheduledMaintenance } from "./maintenance";
import { processIngressQueue } from "./queue";

export { TenantCoordinator };

export default {
  async fetch(request, env): Promise<Response> {
    return handlePipelineRequest(request, env);
  },

  async queue(batch, env): Promise<void> {
    await processIngressQueue(batch, env);
  },

  async scheduled(_controller, env): Promise<void> {
    await runScheduledMaintenance(env);
  },
} satisfies ExportedHandler<Env, IngressQueueMessage>;
