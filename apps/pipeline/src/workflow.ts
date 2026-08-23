import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { ActionWorkflowParams, Env } from "./env";

export class ActionWorkflow extends WorkflowEntrypoint<Env, ActionWorkflowParams> {
  override async run(event: WorkflowEvent<ActionWorkflowParams>, step: WorkflowStep) {
    return step.do("require persisted action ledger", () =>
      Promise.resolve({
        actionRunId: event.payload.actionRunId,
        status: "not-configured" as const,
        userId: event.payload.userId,
      }),
    );
  }
}
