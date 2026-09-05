import {
  filterCompileRequestSchema,
  type FilterPlan,
  type FilterRuleVersion,
} from "@relay/contracts";
import { describe, expect, it } from "vitest";

import { RelayApiError } from "@/lib/relay-api";

import {
  decisionLabel,
  decisionTone,
  describeFilterExpression,
  explainUnsupportedClauses,
  filterDraftError,
  filterDraftFor,
  filterFieldLabel,
  filterPlanSummary,
  filterRevisionHistory,
  filterSaveErrorMessage,
  filterSaveRequest,
  latestFilterRevisions,
  previewFilterCompilation,
  previewFilterOutcomes,
  syntheticPreviewItems,
} from "./filterPresentation";

function revision(overrides: Partial<FilterRuleVersion> = {}): FilterRuleVersion {
  return {
    createdAt: "2026-08-29T10:00:00Z",
    enabled: true,
    id: "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8",
    intent: "Receipts from my bank",
    name: "Receipts",
    plan: {
      compilerVersion: 1,
      deterministic: { field: "source.kind", operator: "equals", value: "sms" },
      intent: "Receipts from my bank",
      schemaVersion: 1,
    },
    seriesId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
    userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    version: 1,
    ...overrides,
  };
}

describe("describeFilterExpression", () => {
  it("renders a predicate in words rather than as JSON", () => {
    expect(
      describeFilterExpression({ field: "sender", operator: "contains", value: "bank" }),
    ).toEqual([{ depth: 0, kind: "predicate", text: "Sender contains bank" }]);
  });

  it("indents nested groups so the connective is visible", () => {
    expect(
      describeFilterExpression({
        all: [
          { field: "source.kind", operator: "equals", value: "sms" },
          { not: { field: "subject", operator: "contains", value: "promo" } },
        ],
      }),
    ).toEqual([
      { depth: 0, kind: "group", text: "All of" },
      { depth: 1, kind: "predicate", text: "Source is sms" },
      { depth: 1, kind: "group", text: "Not" },
      { depth: 2, kind: "predicate", text: "Subject contains promo" },
    ]);
  });

  it("names a plan that can never match instead of showing nothing", () => {
    // The compiler emits `never` for an intent it could not use. A rule that silently matches
    // nothing is the exact surprise this editor exists to prevent.
    expect(describeFilterExpression({ never: true })).toEqual([
      { depth: 0, kind: "predicate", text: "Never matches" },
    ]);
  });

  it("lists every value of an `in` predicate", () => {
    expect(
      describeFilterExpression({ field: "source.kind", operator: "in", value: ["sms", "gmail"] })[0]
        ?.text,
    ).toBe("Source is any of sms, gmail");
  });

  it("renders an exists predicate without a value", () => {
    expect(
      describeFilterExpression({ field: "attributes.amount", operator: "exists" })[0]?.text,
    ).toBe("Amount is present");
  });

  it("returns nothing when a plan has no deterministic half", () => {
    expect(describeFilterExpression(undefined)).toEqual([]);
  });
});

describe("previewFilterCompilation", () => {
  it("treats a half-typed intent as incomplete rather than an error", () => {
    expect(previewFilterCompilation("")).toMatchObject({ status: "incomplete" });
    expect(previewFilterCompilation("   ")).toMatchObject({ status: "incomplete" });
  });

  it("compiles a deterministic intent locally, with no request", () => {
    const preview = previewFilterCompilation("sender contains bank");
    expect(preview.status).toBe("compiled");
    if (preview.status !== "compiled") return;
    expect(preview.compilation.plan.deterministic).toBeDefined();
    expect(preview.compilation.plan.compilerVersion).toBe(1);
  });

  it("surfaces the semantic clause and its allowlist before anything is saved", () => {
    const preview = previewFilterCompilation("anything that feels urgent to me");
    expect(preview.status).toBe("compiled");
    if (preview.status !== "compiled") return;
    expect(preview.compilation.plan.semantic).toBeDefined();
    expect(preview.compilation.plan.semantic?.allowedFields.length).toBeGreaterThan(0);
    expect(preview.compilation.unsupportedClauses.length).toBeGreaterThan(0);
  });

  it("produces the same plan for the same intent, so the preview is stable while typing", () => {
    const first = previewFilterCompilation("sender contains bank");
    const second = previewFilterCompilation("sender contains bank");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("explainUnsupportedClauses", () => {
  it("explains each reason in terms of what happens, not compiler vocabulary", () => {
    const explained = explainUnsupportedClauses([
      { reason: "action-intent-not-allowed", text: "delete it" },
      { reason: "invalid-value", text: "over ??? dollars" },
      { reason: "semantic-required", text: "feels urgent" },
    ]);
    expect(explained[0]?.detail).toContain("cannot choose an action");
    expect(explained[1]?.detail).toContain("match nothing");
    expect(explained[2]?.detail).toContain("question for a model");
  });
});

describe("previewFilterOutcomes", () => {
  const semanticPlan: FilterPlan = {
    compilerVersion: 1,
    intent: "receipts that look like a subscription",
    schemaVersion: 1,
    semantic: {
      allowedFields: ["subject", "body"],
      minimumConfidence: 0.8,
      question: "Is this a subscription receipt?",
    },
  };

  it("never resolves a semantic clause, so a preview cannot reach a provider", () => {
    const outcomes = previewFilterOutcomes(semanticPlan, syntheticPreviewItems);
    expect(outcomes.every((outcome) => outcome.decision === "undecided")).toBe(true);
  });

  it("shows the exact redacted payload a semantic clause would disclose", () => {
    const outcomes = previewFilterOutcomes(semanticPlan, syntheticPreviewItems);
    const receipt = outcomes.find((outcome) => outcome.id === "synthetic-receipt");
    expect(receipt?.disclosure?.disclosedFields).toEqual(["subject", "body"]);
    const body = receipt?.disclosure?.fields.find((field) => field.field === "body");
    expect(body?.value).toContain("[redacted:");
    expect(body?.value).not.toContain("4111");
    expect(body?.value).not.toContain("billing@example.test");
  });

  it("discloses nothing for a field the clause does not allow", () => {
    const outcomes = previewFilterOutcomes(
      { ...semanticPlan, semantic: { ...semanticPlan.semantic!, allowedFields: ["subject"] } },
      syntheticPreviewItems,
    );
    const receipt = outcomes.find((outcome) => outcome.id === "synthetic-receipt");
    expect(receipt?.disclosure?.disclosedFields).toEqual(["subject"]);
    expect(JSON.stringify(receipt?.disclosure)).not.toContain("Card ending");
  });

  it("carries no disclosure when a deterministic rule already decided", () => {
    const outcomes = previewFilterOutcomes(
      {
        compilerVersion: 1,
        deterministic: { field: "source.kind", operator: "equals", value: "sms" },
        intent: "sms only",
        schemaVersion: 1,
      },
      syntheticPreviewItems,
    );
    expect(outcomes.every((outcome) => outcome.disclosure === undefined)).toBe(true);
    expect(outcomes.filter((outcome) => outcome.decision === "match")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.decision === "no-match")).toHaveLength(2);
  });

  it("reports which fields matched so a decision can be explained", () => {
    const outcomes = previewFilterOutcomes(
      {
        compilerVersion: 1,
        deterministic: { field: "sender", operator: "contains", value: "receipts" },
        intent: "from receipts",
        schemaVersion: 1,
      },
      syntheticPreviewItems,
    );
    expect(outcomes.find((outcome) => outcome.id === "synthetic-receipt")?.matchedFields).toEqual([
      "sender",
    ]);
  });

  it("keeps a deterministic rejection away from the semantic clause", () => {
    // A plan whose deterministic half fails is `no-match`, so nothing is disclosed even though the
    // plan carries a semantic clause. This is the rule that stops a preview leaking an item the
    // filter already excluded.
    const outcomes = previewFilterOutcomes(
      {
        ...semanticPlan,
        deterministic: { field: "source.kind", operator: "equals", value: "gmail" },
      },
      syntheticPreviewItems,
    );
    const receipt = outcomes.find((outcome) => outcome.id === "synthetic-receipt");
    expect(receipt?.decision).toBe("no-match");
    expect(receipt?.disclosure).toBeUndefined();
  });
});

describe("synthetic preview corpus", () => {
  it("is entirely invented", () => {
    const serialized = JSON.stringify(syntheticPreviewItems);
    expect(serialized).toContain("example.test");
    expect(syntheticPreviewItems.every((entry) => entry.synthetic)).toBe(true);
  });

  it("covers every source kind the editor can compile against", () => {
    const kinds = syntheticPreviewItems.map(
      (entry) => (entry.item.source as { kind: string }).kind,
    );
    expect(new Set(kinds)).toEqual(new Set(["sms", "gmail", "notification"]));
  });

  it("carries values the redactor must remove, so the disclosure preview is meaningful", () => {
    const receipt = syntheticPreviewItems.find((entry) => entry.id === "synthetic-receipt");
    expect(receipt?.item.body).toContain("4111");
    expect(receipt?.item.body).toContain("@example.test");
  });
});

describe("revisions", () => {
  it("shows only the newest version of each series in the list", () => {
    const rules = latestFilterRevisions([
      revision({ version: 1 }),
      revision({ version: 3, name: "Receipts" }),
      revision({ seriesId: "aaaaaaaa-0000-4000-8000-000000000001", name: "Alerts", version: 1 }),
    ]);
    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.name)).toEqual(["Alerts", "Receipts"]);
    expect(rules.find((rule) => rule.name === "Receipts")?.version).toBe(3);
  });

  it("keeps prior versions inspectable, newest first", () => {
    const history = filterRevisionHistory(
      [revision({ version: 1 }), revision({ version: 3 }), revision({ version: 2 })],
      "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
    );
    expect(history.map((entry) => entry.version)).toEqual([3, 2, 1]);
  });

  it("does not mix series", () => {
    expect(
      filterRevisionHistory(
        [revision(), revision({ seriesId: "aaaaaaaa-0000-4000-8000-000000000001" })],
        "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
      ),
    ).toHaveLength(1);
  });
});

describe("drafts and save requests", () => {
  it("starts a new rule enabled and empty", () => {
    expect(filterDraftFor(undefined)).toEqual({
      categoryId: undefined,
      enabled: true,
      intent: "",
      name: "",
      series: undefined,
    });
  });

  it("carries the series and version forward when editing", () => {
    expect(filterDraftFor(revision({ version: 4 })).series).toEqual({
      expectedVersion: 4,
      seriesId: "06f96f7d-3e1a-4a66-b98e-58be9766b96e",
    });
  });

  it("omits the revision pair for a new rule, which the contract requires", () => {
    const request = filterSaveRequest(filterDraftFor(undefined));
    expect(request.seriesId).toBeUndefined();
    expect(request.expectedVersion).toBeUndefined();
  });

  it("sends seriesId and expectedVersion together when editing", () => {
    // The contract refuses one without the other, so a request missing either is a 400 that would
    // only appear on a device.
    const request = filterSaveRequest({
      ...filterDraftFor(revision({ version: 2 })),
      name: "Receipts",
      intent: "Receipts from my bank",
    });
    expect(request.expectedVersion).toBe(2);
    expect(request.seriesId).toBe("06f96f7d-3e1a-4a66-b98e-58be9766b96e");
  });

  it("trims the name and intent before sending", () => {
    const request = filterSaveRequest({
      categoryId: undefined,
      enabled: true,
      intent: "  sender contains bank  ",
      name: "  Receipts  ",
      series: undefined,
    });
    expect(request.name).toBe("Receipts");
    expect(request.intent).toBe("sender contains bank");
  });

  it.each([
    ["a new rule", filterDraftFor(undefined)],
    ["an edit", filterDraftFor(revision({ version: 2 }))],
  ])("produces a body the API accepts for %s", (_name, base) => {
    const request = filterSaveRequest({
      ...base,
      intent: "sender contains bank",
      name: "Receipts",
    });
    expect(filterCompileRequestSchema.safeParse(request).success).toBe(true);
  });

  it("rejects an empty name or intent before a request is made", () => {
    expect(
      filterDraftError({
        categoryId: undefined,
        enabled: true,
        intent: "x",
        name: "",
        series: undefined,
      }),
    ).toContain("name");
    expect(
      filterDraftError({
        categoryId: undefined,
        enabled: true,
        intent: "",
        name: "x",
        series: undefined,
      }),
    ).toContain("match");
    expect(
      filterDraftError({
        categoryId: undefined,
        enabled: true,
        intent: "x",
        name: "y",
        series: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("filterSaveErrorMessage", () => {
  it.each([
    ["filter_revision_conflict", "changed somewhere else"],
    ["invalid_filter_intent", "could not read"],
    ["filter_compilation_unavailable", "draft is unchanged"],
  ])("explains %s", (apiCode, fragment) => {
    expect(filterSaveErrorMessage(new RelayApiError("validation", { apiCode }))).toContain(
      fragment,
    );
  });

  it("tells a conflicted editor what to do rather than just reporting a clash", () => {
    const message = filterSaveErrorMessage(
      new RelayApiError("validation", { apiCode: "filter_revision_conflict" }),
    );
    expect(message).toContain("Reopen");
  });

  it("falls back to the transport reason with no code", () => {
    expect(filterSaveErrorMessage(new RelayApiError("unauthorized"))).toContain("session expired");
    expect(filterSaveErrorMessage(new RelayApiError("network"))).toContain("unreachable");
  });

  it("never surfaces an underlying error's text", () => {
    expect(
      filterSaveErrorMessage(new Error("constraint filter_rules_pkey on user 42")),
    ).not.toContain("filter_rules_pkey");
  });
});

describe("labels", () => {
  it("names every decision in the user's terms", () => {
    expect(decisionLabel("match")).toBe("Matches");
    expect(decisionLabel("no-match")).toBe("No match");
    expect(decisionLabel("undecided")).toBe("Needs a model");
    expect(decisionTone("undecided")).toBe("warning");
    expect(decisionTone("match")).toBe("success");
  });

  it("labels every field the compiler can emit", () => {
    for (const field of [
      "attributes.amount",
      "attributes.currency",
      "attributes.merchant",
      "body",
      "category",
      "sender",
      "source.applicationId",
      "source.kind",
      "subject",
    ] as const) {
      expect(filterFieldLabel(field)).not.toBe("");
    }
  });

  it("summarises a plan by what decides it", () => {
    expect(filterPlanSummary(revision().plan)).toContain("1 deterministic check");
    expect(
      filterPlanSummary({
        compilerVersion: 1,
        intent: "urgent",
        schemaVersion: 1,
        semantic: { allowedFields: ["subject"], minimumConfidence: 0.8, question: "Urgent?" },
      }),
    ).toContain("80% confidence");
  });

  it("says plainly when a plan matches nothing", () => {
    expect(
      filterPlanSummary({
        compilerVersion: 1,
        deterministic: { never: true },
        intent: "unusable",
        schemaVersion: 1,
      }),
    ).toBe("Matches nothing");
  });
});

describe("filter category selection", () => {
  const draft = {
    categoryId: undefined as string | undefined,
    enabled: true,
    intent: "Marketing or promotional material",
    name: "Marketing",
    series: undefined,
  };

  it("sends the chosen category so a match has somewhere to go", () => {
    const request = filterSaveRequest({
      ...draft,
      categoryId: "8f4b1c2d-0000-4000-8000-00000000ab01",
    });
    expect(request.categoryId).toBe("8f4b1c2d-0000-4000-8000-00000000ab01");
  });

  it("sends null rather than omitting the field when no category is chosen", () => {
    // An absent field reads as "unchanged" to the revision RPC, which would leave a rule pointed at
    // a category the editor is no longer showing as selected.
    expect(filterSaveRequest(draft).categoryId).toBeNull();
  });

  it("restores the stored category when an existing rule is reopened", () => {
    const restored = filterDraftFor({
      categoryId: "8f4b1c2d-0000-4000-8000-00000000ab01",
      createdAt: "2026-09-01T09:00:00.000Z",
      enabled: true,
      id: "1f4b1c2d-0000-4000-8000-00000000ab02",
      intent: "Marketing or promotional material",
      name: "Marketing",
      plan: { compilerVersion: 1, intent: "Marketing or promotional material", schemaVersion: 1 },
      seriesId: "2f4b1c2d-0000-4000-8000-00000000ab03",
      userId: "3f4b1c2d-0000-4000-8000-00000000ab04",
      version: 3,
    });
    expect(restored.categoryId).toBe("8f4b1c2d-0000-4000-8000-00000000ab01");
  });
});
