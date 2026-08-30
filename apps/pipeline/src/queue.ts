import {
  deadLetterFailureCodeSchema,
  ingressQueueMessageSchema,
  MAX_INGRESS_QUEUE_MESSAGE_BYTES,
  relayUserIdSchema,
  type DeadLetterFailureCode,
} from "@relay/contracts";

import type { Env, IngressQueueMessage } from "./env";
import { recordPipelineMetric } from "./metrics";
import { logPipelineError } from "./observability";
import { completeDeadLetterReplay, recordDeadLetterItem } from "./recovery";

const REPLAY_REQUEST_FIELD_BYTES = 57;
const FAILURE_CODE_FIELD_BYTES = 56;
const MAX_PROCESSING_ATTEMPTS = 5;
const DEAD_LETTER_RETRY_DELAY_SECONDS = 300;
const DEAD_LETTER_FALLBACK_RETRY_DELAY_SECONDS = 600;

export function prepareIngressQueueMessage(value: unknown): IngressQueueMessage | undefined {
  const parsed = ingressQueueMessageSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const serializedBytes = new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength;
  const replayReserve = parsed.data.replayRequestId === undefined ? REPLAY_REQUEST_FIELD_BYTES : 0;
  const failureReserve = parsed.data.failureCode === undefined ? FAILURE_CODE_FIELD_BYTES : 0;
  return serializedBytes + replayReserve + failureReserve <= MAX_INGRESS_QUEUE_MESSAGE_BYTES
    ? parsed.data
    : undefined;
}

async function routeFailedMessage(
  message: Message<IngressQueueMessage>,
  value: IngressQueueMessage,
  failureCode: DeadLetterFailureCode,
  env: Env,
): Promise<void> {
  const maxAttempts = env.RELAY_E2E_MODE === "true" ? 1 : MAX_PROCESSING_ATTEMPTS;
  if (message.attempts < maxAttempts) {
    message.retry();
    return;
  }
  await env.DEAD_LETTER_QUEUE.send({ ...value, failureCode });
  message.ack();
}

export async function publishIngressQueueMessage(
  queue: Queue<IngressQueueMessage>,
  value: unknown,
): Promise<boolean> {
  const message = prepareIngressQueueMessage(value);
  if (message === undefined) return false;
  await queue.send(message);
  return true;
}

export async function processIngressQueue(
  batch: MessageBatch<IngressQueueMessage>,
  env: Env,
): Promise<void> {
  if (env.RELAY_DEAD_LETTER_QUEUE !== undefined && batch.queue === env.RELAY_DEAD_LETTER_QUEUE) {
    for (const message of batch.messages) {
      const parsed = ingressQueueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        message.ack();
        continue;
      }
      try {
        await recordDeadLetterItem(
          env,
          parsed.data,
          parsed.data.failureCode ?? "retry_exhausted_unknown",
        );
        if (env.RELAY_E2E_MODE === "true") {
          const coordinator = env.TENANT_COORDINATOR.getByName(
            relayUserIdSchema.parse(parsed.data.userId),
          );
          const response = await coordinator.fetch("https://coordinator.internal/e2e/result", {
            method: "POST",
            body: JSON.stringify(parsed.data),
          });
          if (!response.ok) throw new Error("E2E dead-letter receipt failed");
        }
        message.ack();
      } catch (error: unknown) {
        logPipelineError(env, "queue.dead_letter_persistence_failed", error, {
          code: "DEAD_LETTER_PERSISTENCE_FAILED",
          integration: "supabase",
          operation: "recordDeadLetterItem",
        });
        if (Date.parse(parsed.data.rawExpiresAt) <= Date.now()) {
          message.ack();
          continue;
        }
        try {
          await env.DEAD_LETTER_QUEUE.send(parsed.data, {
            delaySeconds: DEAD_LETTER_RETRY_DELAY_SECONDS,
          });
          message.ack();
        } catch (parkingError: unknown) {
          logPipelineError(env, "queue.dead_letter_parking_failed", parkingError, {
            code: "DEAD_LETTER_PARKING_FAILED",
            integration: "cloudflare-queue",
            operation: "parkDeadLetterMessage",
          });
          recordPipelineMetric(env.PIPELINE_METRICS, "dead_letter_parking_failed", 1, 0, env.DEBUG);
          message.retry({ delaySeconds: DEAD_LETTER_FALLBACK_RETRY_DELAY_SECONDS });
        }
      }
    }
    return;
  }

  for (const message of batch.messages) {
    const parsed = ingressQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }

    try {
      const coordinator = env.TENANT_COORDINATOR.getByName(
        relayUserIdSchema.parse(parsed.data.userId),
      );
      const response = await coordinator.fetch("https://coordinator.internal/process", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      if (response.ok) {
        let result: { reason?: unknown } | undefined;
        try {
          result = await response.json<{ reason?: unknown }>();
        } catch (error: unknown) {
          logPipelineError(env, "queue.coordinator_response_invalid", error, {
            code: "COORDINATOR_RESPONSE_INVALID",
            integration: "tenant-coordinator",
            operation: "processIngressMessage",
          });
        }
        if (result?.reason !== "duplicate" && result?.reason !== "persisted") {
          await routeFailedMessage(message, parsed.data, "coordinator_unavailable", env);
          continue;
        }
        const completion = result?.reason === "duplicate" ? "duplicate" : "succeeded";
        await completeDeadLetterReplay(env, parsed.data, completion);
        message.ack();
      } else if (response.status === 410) {
        if (parsed.data.replayRequestId !== undefined) {
          await recordDeadLetterItem(env, parsed.data, "retry_exhausted_unknown");
        }
        message.ack();
      } else {
        let result: { failureCode?: unknown } | undefined;
        try {
          result = await response.json<{ failureCode?: unknown }>();
        } catch (error: unknown) {
          logPipelineError(env, "queue.coordinator_response_invalid", error, {
            code: "COORDINATOR_RESPONSE_INVALID",
            integration: "tenant-coordinator",
            operation: "processIngressMessage",
          });
        }
        const failureCode = deadLetterFailureCodeSchema.safeParse(result?.failureCode);
        await routeFailedMessage(
          message,
          parsed.data,
          failureCode.success ? failureCode.data : "coordinator_unavailable",
          env,
        );
      }
    } catch (error: unknown) {
      logPipelineError(env, "queue.ingress_processing_failed", error, {
        code: "INGRESS_PROCESSING_FAILED",
        integration: "tenant-coordinator",
        operation: "processIngressMessage",
      });
      try {
        await routeFailedMessage(message, parsed.data, "coordinator_unavailable", env);
      } catch (routingError: unknown) {
        logPipelineError(env, "queue.failure_routing_failed", routingError, {
          code: "INGRESS_FAILURE_ROUTING_FAILED",
          integration: "cloudflare-queue",
          operation: "routeFailedMessage",
        });
        message.retry();
      }
    }
  }
}
