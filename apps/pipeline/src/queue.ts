import { ingressQueueMessageSchema, MAX_INGRESS_QUEUE_MESSAGE_BYTES } from "@relay/contracts";

import type { Env, IngressQueueMessage } from "./env";

export function prepareIngressQueueMessage(value: unknown): IngressQueueMessage | undefined {
  const parsed = ingressQueueMessageSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const serializedBytes = new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength;
  return serializedBytes <= MAX_INGRESS_QUEUE_MESSAGE_BYTES ? parsed.data : undefined;
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
  for (const message of batch.messages) {
    const parsed = ingressQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }

    try {
      const coordinator = env.TENANT_COORDINATOR.getByName(parsed.data.userId);
      const response = await coordinator.fetch("https://coordinator.internal/process", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      if (response.ok) message.ack();
      else message.retry();
    } catch {
      message.retry();
    }
  }
}
