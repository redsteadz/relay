/**
 * What the device model path did, kept where the reader can see it.
 *
 * Every refusal on the device semantic path is an outcome rather than an error: a model that is
 * unreachable, unconfigured, or answering with the wrong shape leaves a capture awaiting a model and
 * a notification alone, exactly as designed. What the design left out was any way to learn that
 * from the phone. The quiet screen said "waiting on your model" whether the model had been asked
 * and refused, or never asked because the notification shade could not be read, or never asked
 * because the pass found no model configured -- and the records that would have told the difference
 * were written to a local table nothing displayed.
 *
 * This is the journal that closes that gap. Each pass over the pending work writes one report: when
 * it ran, what triggered it, why it stopped where it did, how many candidates it found, and for each
 * model request the host, the model, the protocol, the duration, the HTTP status and the refusal.
 * Metadata only. No notification text, no question, no field value, no URL beyond the host the
 * disclosure history already records, and no key. The same allowlist the structured logs keep, held
 * on the device for the reader rather than in a console nobody attaches.
 *
 * Bounded to the last few passes per tenant, because a diagnostic that grows without limit is a log,
 * and the point is the most recent answer to "why did nothing happen". See
 * [ADR-0023](../../../docs/decisions/0023-quiet-on-the-rule-and-model-diagnostics.md).
 */

import type { FilterPlan, SemanticProtocol } from "@relay/contracts";
import type { FilterDecision } from "@relay/domain";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  evaluateDeviceSemanticClause,
  type DeviceSemanticRefusal,
  type DeviceSemanticResult,
} from "./device-semantic";
import { logMobileError } from "./observability";

/** One model request, as the journal keeps it. Everything here is bounded and content-free. */
export type DeviceModelAttempt = {
  decision: FilterDecision;
  durationMs: number;
  /** The host contacted, when a request left the device. Never a full address. */
  host?: string;
  model?: string;
  protocol?: SemanticProtocol;
  refusal?: DeviceSemanticRefusal;
  statusCode?: number;
};

/** Which pass wrote the report. Each has a different reason to exist and a different reader. */
export type DeviceModelPassKind = "filing" | "probe" | "quiet";

/** What started the pass. A background run has no reader present, which changes how to read it. */
export type DeviceModelPassTrigger = "background" | "foreground" | "manual";

/**
 * Why a pass stopped where it did.
 *
 * `evaluated` is the only outcome in which a model was asked anything. Every other value names the
 * gate that stopped the pass before a request, which is the question a reader has when the quiet
 * verdicts say "waiting" and nothing ever arrives at the model.
 */
export type DeviceModelPassOutcome =
  | "evaluated"
  | "failed"
  | "no-candidates"
  | "none-posted"
  | "not-configured"
  | "shade-unreadable"
  | "store-unsupported";

export type DeviceModelPassCounts = {
  acted: number;
  candidates: number;
  evaluated: number;
  /** Candidates whose retained content had expired, so there was nothing to ask about. */
  skippedNoContent: number;
  /** Candidates naming a rule revision no longer enabled or current. */
  skippedRuleGone: number;
  undecided: number;
};

export type DeviceModelPassReport = {
  attempts: DeviceModelAttempt[];
  counts: DeviceModelPassCounts;
  durationMs: number;
  kind: DeviceModelPassKind;
  outcome: DeviceModelPassOutcome;
  startedAt: string;
  trigger: DeviceModelPassTrigger;
};

/** How many passes the journal keeps per tenant. Recent is the point; history is the disclosure table. */
export const DEVICE_MODEL_JOURNAL_LIMIT = 12;
/** How many attempts one report carries. A pass is bounded to eight requests anyway. */
export const DEVICE_MODEL_ATTEMPT_LIMIT = 8;

export const EMPTY_PASS_COUNTS: DeviceModelPassCounts = Object.freeze({
  acted: 0,
  candidates: 0,
  evaluated: 0,
  skippedNoContent: 0,
  skippedRuleGone: 0,
  undecided: 0,
});

/** The journal entry for one evaluation result. Picks the allowlisted fields and nothing else. */
export function attemptFromResult(result: DeviceSemanticResult): DeviceModelAttempt {
  return {
    decision: result.decision,
    durationMs: result.durationMs,
    ...(result.disclosure === undefined
      ? {}
      : { host: result.disclosure.host, model: result.disclosure.model }),
    ...(result.protocol === undefined ? {} : { protocol: result.protocol }),
    ...(result.refusal === undefined ? {} : { refusal: result.refusal }),
    ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
  };
}

function journalKey(tenantId: string): string {
  return `relay-model-journal.${tenantId}`;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function notify(tenantId: string): void {
  for (const listener of listeners.get(tenantId) ?? []) listener();
}

/** Called after every write, so a screen showing the journal redraws without polling. */
export function subscribeDeviceModelJournal(tenantId: string, listener: Listener): () => void {
  const set = listeners.get(tenantId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(tenantId, set);
  return () => {
    set.delete(listener);
  };
}

function isReport(value: unknown): value is DeviceModelPassReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.startedAt === "string" &&
    typeof record.kind === "string" &&
    typeof record.outcome === "string" &&
    Array.isArray(record.attempts) &&
    typeof record.counts === "object" &&
    record.counts !== null
  );
}

/** The most recent passes, newest first. An unreadable journal reads as empty rather than throwing. */
export async function readDeviceModelJournal(tenantId: string): Promise<DeviceModelPassReport[]> {
  let stored: string | null;
  try {
    stored = await AsyncStorage.getItem(journalKey(tenantId));
  } catch (error: unknown) {
    logMobileError("semantic.journal_unreadable", error, {
      code: "DEVICE_MODEL_JOURNAL_UNREADABLE",
      integration: "async-storage",
      operation: "readDeviceModelJournal",
    });
    return [];
  }
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isReport) : [];
  } catch {
    // A journal this build cannot read is replaced by the next write. Nothing in it is needed.
    return [];
  }
}

/**
 * Appends one report, dropping the oldest past the limit.
 *
 * Never throws. This runs at the end of passes whose job is to make progress where they can, and
 * failing to write a diagnostic must not become the thing a reader has to diagnose.
 */
export async function recordDeviceModelPass(
  tenantId: string,
  report: DeviceModelPassReport,
): Promise<void> {
  const bounded: DeviceModelPassReport = {
    ...report,
    attempts: report.attempts.slice(0, DEVICE_MODEL_ATTEMPT_LIMIT),
  };
  try {
    const existing = await readDeviceModelJournal(tenantId);
    const next = [bounded, ...existing].slice(0, DEVICE_MODEL_JOURNAL_LIMIT);
    await AsyncStorage.setItem(journalKey(tenantId), JSON.stringify(next));
  } catch (error: unknown) {
    logMobileError("semantic.journal_unwritable", error, {
      code: "DEVICE_MODEL_JOURNAL_UNWRITABLE",
      integration: "async-storage",
      metadata: { kind: report.kind, outcome: report.outcome },
      operation: "recordDeviceModelPass",
    });
  }
  notify(tenantId);
}

export async function clearDeviceModelJournal(tenantId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(journalKey(tenantId));
  } catch (error: unknown) {
    logMobileError("semantic.journal_unclearable", error, {
      code: "DEVICE_MODEL_JOURNAL_UNCLEARABLE",
      integration: "async-storage",
      operation: "clearDeviceModelJournal",
    });
  }
  notify(tenantId);
}

/**
 * A pass, timed and recorded.
 *
 * `run` reports its own outcome rather than throwing for the ordinary gates; a thrown error is the
 * one case recorded as `failed`, and it is rethrown so the caller's own terminal log still happens.
 */
export async function journaledDeviceModelPass<Result>(
  tenantId: string,
  kind: DeviceModelPassKind,
  trigger: DeviceModelPassTrigger,
  run: () => Promise<
    { result: Result } & Omit<
      DeviceModelPassReport,
      "durationMs" | "kind" | "startedAt" | "trigger"
    >
  >,
): Promise<Result> {
  const startedAt = Date.now();
  try {
    const { result, ...report } = await run();
    await recordDeviceModelPass(tenantId, {
      ...report,
      durationMs: Date.now() - startedAt,
      kind,
      startedAt: new Date(startedAt).toISOString(),
      trigger,
    });
    return result;
  } catch (error: unknown) {
    await recordDeviceModelPass(tenantId, {
      attempts: [],
      counts: EMPTY_PASS_COUNTS,
      durationMs: Date.now() - startedAt,
      kind,
      outcome: "failed",
      startedAt: new Date(startedAt).toISOString(),
      trigger,
    });
    throw error;
  }
}

/**
 * The clause a probe asks, and the capture it asks about.
 *
 * Entirely synthetic, so pressing "test" discloses nothing a reader received. It is also chosen to
 * have an obvious answer, so a model that is reachable and well-configured returns a confident
 * `match` and a reader can tell "it works" from "it answered something".
 */
export const DEVICE_MODEL_PROBE_CLAUSE: NonNullable<FilterPlan["semantic"]> = {
  allowedFields: ["subject", "body"],
  minimumConfidence: 0.5,
  question: "Is this a promotional or marketing message?",
};

export const DEVICE_MODEL_PROBE_ITEM: Record<string, unknown> = {
  body: "Half price on everything this weekend only. Offer ends Sunday.",
  source: { applicationId: "com.example.shop", kind: "notification" },
  subject: "Weekend sale: 50% off",
};

/**
 * Asks the configured model one synthetic question and journals the answer.
 *
 * This is the direct test a reader reaches for when nothing arrives at their model's dashboard: it
 * takes the pending work, the shade, retention and the rules out of the question and asks only
 * whether this phone can get a decision from that endpoint right now.
 */
export async function probeDeviceModel(
  tenantId: string,
  config: unknown,
  options: { fetcher?: (input: string, init?: RequestInit) => Promise<Response> } = {},
): Promise<DeviceSemanticResult> {
  return journaledDeviceModelPass(tenantId, "probe", "manual", async () => {
    const result = await evaluateDeviceSemanticClause(
      DEVICE_MODEL_PROBE_CLAUSE,
      DEVICE_MODEL_PROBE_ITEM,
      config,
      options.fetcher === undefined ? {} : { fetcher: options.fetcher },
    );
    const asked = result.refusal !== "not-configured" && result.refusal !== "endpoint-invalid";
    return {
      attempts: [attemptFromResult(result)],
      counts: {
        ...EMPTY_PASS_COUNTS,
        candidates: 1,
        evaluated: asked ? 1 : 0,
        undecided: result.decision === "undecided" ? 1 : 0,
      },
      outcome: result.refusal === "not-configured" ? "not-configured" : "evaluated",
      result,
    };
  });
}
