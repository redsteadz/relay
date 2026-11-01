import {
  webhookActionInputSchema,
  type RelayEvent,
  type WebhookActionInput,
  type WebhookInputTemplate,
} from "@relay/contracts";

/**
 * Renders a webhook run's input from its rule's field selection and one event.
 *
 * Copies only the selected fields, and of those only the ones the event has: an absent value is left
 * out rather than sent as `null`, so a receiver never mistakes "not selected" for "selected and
 * empty" in one direction or the other. The result is parsed through the contract, so a field
 * outside the allowlist cannot reach a run's input even if the template was built without it.
 */
export function renderWebhookInput(
  template: WebhookInputTemplate,
  event: RelayEvent,
): WebhookActionInput {
  const source = event as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const field of template.fields) {
    const value = source[field];
    if (value !== undefined) fields[field] = value;
  }
  return webhookActionInputSchema.parse({ eventType: event.kind, fields });
}
