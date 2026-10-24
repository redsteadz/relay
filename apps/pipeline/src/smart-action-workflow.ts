import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { canonicalUuidSchema } from "@relay/contracts";
import { executeSmartRun, SmartAutomationRepository } from "./smart-automations";
import type { Env } from "./env";

export class SmartActionWorkflow extends WorkflowEntrypoint<
  Env,
  { userId: string; runId: string }
> {
  override async run(
    event: WorkflowEvent<{ userId: string; runId: string }>,
    step: WorkflowStep,
  ): Promise<void> {
    const userId = canonicalUuidSchema.parse(event.payload.userId);
    const runId = canonicalUuidSchema.parse(event.payload.runId);
    // Step parameters/results contain only IDs; credentials exist only during the provider call.
    await step.do(
      "execute-authorized-action",
      { retries: { limit: 4, delay: "30 seconds", backoff: "exponential" }, timeout: "90 seconds" },
      async () => {
        await executeSmartRun(new SmartAutomationRepository(this.env), userId, runId);
      },
    );
  }
}
