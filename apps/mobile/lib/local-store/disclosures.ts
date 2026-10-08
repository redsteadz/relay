import { SEMANTIC_DISCLOSURE_PURPOSE, type SemanticDisclosure } from "@relay/contracts";

import type { DeviceSemanticResult } from "../device-semantic";
import type { LocalStore } from "./database";

/**
 * What this device sent to a model, and where it went.
 *
 * [ADR-0019](../../../../docs/decisions/0019-device-semantic-evaluation.md) lets the device evaluate
 * a semantic clause against an endpoint the reader configured, which creates the disclosure
 * obligation the pipeline already carries. The device records its own from the start rather than
 * inheriting the gap in [#205](https://github.com/redsteadz/relay/issues/205), where the server path
 * records nothing.
 *
 * Metadata only, and that is the point. Field *names*, redaction counts, the endpoint host, the
 * model, the decision. Never the prompt, never a disclosed value, and deliberately not the model's
 * `rationale`: the server keeps that, but it is text a model wrote about a capture, and this store's
 * stated property is that it is no second home for such text. The decision and the rule that
 * produced it are what the dry-run review needs.
 *
 * `endpoint_host` matters more here than server-side. A device endpoint is frequently a machine on
 * the reader's own network, and history that implied OpenAI would be wrong in the direction that
 * matters.
 */
export type DeviceDisclosureRecord = {
  filterRuleId: string | undefined;
  id: string;
  result: DeviceSemanticResult;
  sourceItemId: string;
};

/**
 * What was removed, from where, and how much of it.
 *
 * The field name is kept because it discloses nothing new -- `disclosed_fields` already names every
 * field that was sent -- and it is the difference between "an email address was removed" and "an
 * email address was removed from the sender", which is the version a reader can act on.
 */
function redactionSummary(disclosure: SemanticDisclosure): string {
  return JSON.stringify(
    disclosure.redactions.map((entry) => ({
      count: entry.count,
      field: entry.field,
      kind: entry.kind,
    })),
  );
}

/**
 * Records one device evaluation.
 *
 * Written whether or not the model answered, because an attempt that sent data and got nothing
 * useful back still disclosed it. `disclosed` is false only when the clause was refused before
 * anything left the device, which is exactly the case `DeviceSemanticResult` reports by carrying no
 * disclosure.
 */
export async function recordDeviceDisclosure(
  database: LocalStore,
  tenantId: string,
  record: DeviceDisclosureRecord,
  now = new Date().toISOString(),
): Promise<void> {
  const sent = record.result.disclosure;
  await database.runAsync(
    `INSERT INTO ai_disclosures (
       tenant_id, id, source_item_id, filter_rule_id, model, disclosed_fields, redactions,
       purpose, decision, disclosed, confidence, failure_reason, endpoint_host, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [
      tenantId,
      record.id,
      record.sourceItemId,
      record.filterRuleId ?? null,
      sent?.model ?? "",
      // The contract's own canonical list of names, rather than names re-derived from the entries
      // that carry values. A value here would make this the second home for captured text that the
      // schema's forbidden-column test exists to prevent.
      JSON.stringify(sent?.disclosure.disclosedFields ?? []),
      sent === undefined ? "[]" : redactionSummary(sent.disclosure),
      SEMANTIC_DISCLOSURE_PURPOSE,
      record.result.decision,
      sent === undefined ? 0 : 1,
      null,
      record.result.refusal ?? null,
      sent?.host ?? null,
      now,
    ],
  );
}

export type StoredDeviceDisclosure = {
  created_at: string;
  decision: string;
  disclosed: number;
  disclosed_fields: string;
  endpoint_host: string | null;
  failure_reason: string | null;
  filter_rule_id: string | null;
  id: string;
  model: string;
  provider: string;
  purpose: string;
  redactions: string;
  source_item_id: string;
};

/** The device's own disclosure history, newest first, for the privacy screen to show beside the server's. */
export async function deviceDisclosures(
  database: LocalStore,
  tenantId: string,
  limit = 100,
): Promise<StoredDeviceDisclosure[]> {
  return database.getAllAsync<StoredDeviceDisclosure>(
    `SELECT id, source_item_id, filter_rule_id, provider, model, disclosed_fields, redactions,
            purpose, decision, disclosed, failure_reason, endpoint_host, created_at
       FROM ai_disclosures
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [tenantId, Math.max(1, Math.min(limit, 500))],
  );
}
