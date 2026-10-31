import type { RelayEvent } from "@relay/contracts";
import { describe, expect, it } from "vitest";

import { renderWebhookInput } from "../src/webhook.js";

const event: RelayEvent = {
  id: "6f98ad81-f071-418b-a426-8c8c9f627161",
  sourceItemId: "cbf55db3-fabe-460d-af9e-68f49cfcaa78",
  normalizerVersion: 1,
  extractorVersion: 1,
  ordinal: 0,
  kind: "reminder",
  title: "Invoice reminder",
  summary: "Invoice reference available.",
  confidence: 0.9,
  requiresReview: false,
  temporalStatus: "resolved",
  timeZone: "UTC",
  dueAt: "2026-11-02T09:00:00.000Z",
  provenance: [{ factOrdinal: 0, fields: [{ path: "subject", start: 0, end: 7 }] }],
};

describe("renderWebhookInput", () => {
  it("copies only the selected fields and always carries the event kind", () => {
    expect(renderWebhookInput({ fields: ["title", "dueAt"] }, event)).toEqual({
      eventType: "reminder",
      fields: { title: "Invoice reminder", dueAt: "2026-11-02T09:00:00.000Z" },
    });
  });

  it("leaves out a selected field the event does not have", () => {
    expect(renderWebhookInput({ fields: ["startsAt", "title"] }, event).fields).toEqual({
      title: "Invoice reminder",
    });
  });

  it("never copies provenance, identity or source references", () => {
    const rendered = renderWebhookInput(
      { fields: ["title", "summary", "dueAt", "confidence", "requiresReview"] },
      event,
    );
    expect(Object.keys(rendered.fields).sort()).toEqual([
      "confidence",
      "dueAt",
      "requiresReview",
      "summary",
      "title",
    ]);
    expect(JSON.stringify(rendered)).not.toContain(event.sourceItemId);
  });

  it("refuses a template that names a field outside the allowlist", () => {
    expect(() =>
      renderWebhookInput({ fields: ["provenance"] } as unknown as { fields: ["title"] }, event),
    ).toThrow();
  });
});
