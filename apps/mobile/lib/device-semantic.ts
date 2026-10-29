/**
 * Deciding a semantic clause on the device.
 *
 * [ADR-0014](../../../docs/decisions/0014-device-local-classification.md) kept every semantic
 * decision on the server because the device held no model credential, so a semantic clause
 * dead-ended as `awaiting-model` and could never quiet a notification. That was an architecture
 * boundary rather than a platform limit: a BYOK call is an HTTPS request to an OpenAI-compatible
 * endpoint, and a phone can make one — including to a model running on the reader's own machine.
 * [ADR-0019](../../../docs/decisions/0019-device-semantic-evaluation.md) moves the boundary.
 *
 * Everything that decides what leaves the device is shared, not reimplemented here:
 * `minimizeSemanticDisclosure` applies the clause's field allowlist and the redactions,
 * `semanticEvaluationRequestBody` builds the request including the instruction block that states
 * captured content is data rather than instruction, `parseSemanticEvaluation` refuses anything that
 * is not one stopped choice, and `resolveSemanticDecision` applies the confidence threshold. This
 * module owns the request and nothing else.
 *
 * Every failure is `undecided`. A model that is slow, unreachable, unconfigured or wrong leaves the
 * capture exactly as it was — awaiting a model — and leaves a notification alone. A local endpoint is
 * reachable only while the phone is on that network, so "the reader left the house" is an ordinary
 * outcome here rather than an error.
 *
 * Every outcome also says *what happened*, in bounded metadata: how long the attempt took, the
 * protocol it spoke, and the HTTP status when a reply arrived. A refusal that cannot be told apart
 * from "nothing ran" is what left readers staring at "waiting on your model" with no way to learn
 * that the model had answered 401 for a week. See
 * [ADR-0023](../../../docs/decisions/0023-quiet-on-the-rule-and-model-diagnostics.md).
 */

import {
  deviceSemanticConfigSchema,
  type DeviceSemanticConfig,
  type FilterPlan,
  type SemanticDisclosure,
  type SemanticProtocol,
} from "@relay/contracts";
import {
  MAX_SEMANTIC_RESPONSE_BYTES,
  minimizeSemanticDisclosure,
  parseSemanticBaseUrl,
  parseSemanticEvaluation,
  parseSystemOneEvaluation,
  resolveSemanticDecision,
  semanticEvaluationRequestBody,
  systemOneRequestBody,
  type FilterDecision,
} from "@relay/domain";

type SemanticClause = NonNullable<FilterPlan["semantic"]>;

/** Why a device evaluation produced no decision. Each is a state, not an incident. */
export type DeviceSemanticRefusal =
  | "endpoint-invalid"
  | "endpoint-unreachable"
  | "invalid-response"
  | "not-configured"
  | "rejected"
  | "response-too-large"
  | "timed-out";

export type DeviceSemanticResult = {
  decision: FilterDecision;
  /**
   * Present only when a request actually left the device, which is also what makes `host`
   * meaningful: an attempt that sent nothing never names an endpoint it did not contact.
   */
  disclosure?: { disclosure: SemanticDisclosure; host: string; model: string };
  /** Wall-clock time from the start of the attempt to its outcome, including a refusal. */
  durationMs: number;
  /** Which wire format was spoken. Absent only when the configuration could not be read at all. */
  protocol?: SemanticProtocol;
  refusal?: DeviceSemanticRefusal;
  /**
   * The HTTP status of the reply, when one arrived.
   *
   * A status code is bounded, enumerable metadata the observability guide permits. It is the one
   * fact that separates "the key is wrong" (401) from "the model is wrong" (404 on a route the server
   * never had) from "the server is down" (503), and every one of those used to read as `rejected`.
   */
  statusCode?: number;
};

/** How long the reader waits before a notification is left alone. */
export const DEVICE_SEMANTIC_TIMEOUT_MS = 8_000;

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

/**
 * Evaluates one clause against one capture.
 *
 * `fetcher` is injected so the whole path above the network is testable without one. The caller
 * supplies the item in the same shape `evaluateFilterPlan` reads, so the allowlist resolves the same
 * fields it would have server-side.
 */
export async function evaluateDeviceSemanticClause(
  clause: SemanticClause,
  item: Record<string, unknown>,
  config: unknown,
  options: {
    fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
  } = {},
): Promise<DeviceSemanticResult> {
  const startedAt = Date.now();
  const undecided = (
    refusal: DeviceSemanticRefusal,
    extra: Partial<DeviceSemanticResult> = {},
  ): DeviceSemanticResult => ({
    decision: "undecided",
    durationMs: elapsed(startedAt),
    refusal,
    ...extra,
  });

  const parsedConfig = deviceSemanticConfigSchema.safeParse(config);
  if (!parsedConfig.success) return undecided("not-configured");
  const settings: DeviceSemanticConfig = parsedConfig.data;
  const protocol = settings.protocol;

  // The device is on the network it is asking about and is making a request its owner configured,
  // so a LAN address is the point rather than an SSRF risk. Every server-side caller keeps the
  // strict policy; this is the same parser with a different argument.
  const endpoint = parseSemanticBaseUrl(settings.baseUrl, { allowLocalNetwork: true });
  if (endpoint === undefined) return undecided("endpoint-invalid", { protocol });

  // Minimization happens once, before either protocol sees anything. What leaves the device is
  // decided by the clause's allowlist and the redactions, never by the wire format.
  const disclosure = minimizeSemanticDisclosure(clause, item);
  const systemOne = protocol === "system-one";
  const body = systemOne
    ? systemOneRequestBody(clause, disclosure, { model: settings.model })
    : semanticEvaluationRequestBody(clause, disclosure, {
        model: settings.model,
        responseFormat: settings.responseFormat,
      });
  // A decision engine answers in one forward pass and has no completions route.
  const route = systemOne ? "/systemone" : "/chat/completions";
  const sent = { disclosure, host: endpoint.host, model: settings.model };

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEVICE_SEMANTIC_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetcher(`${endpoint.baseUrl}${route}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        // A local server usually wants no credential, and sending an empty bearer to one that does
        // not expect it is a good way to be refused.
        ...(settings.apiKey === undefined ? {} : { authorization: `Bearer ${settings.apiKey}` }),
      },
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    // Deliberately opaque: the cause carries the endpoint, which is the reader's own network
    // topology and has no business in an outcome this module returns.
    return undecided(controller.signal.aborted ? "timed-out" : "endpoint-unreachable", {
      disclosure: sent,
      protocol,
    });
  } finally {
    clearTimeout(timeout);
  }

  const replied = { disclosure: sent, protocol, statusCode: response.status };
  if (!response.ok) return undecided("rejected", replied);

  const text = await response.text();
  // Bounded before parsing. A reply larger than this is not a decision whatever it claims to be,
  // and a local endpoint is exactly where an accidental model dump would arrive from.
  if (text.length > MAX_SEMANTIC_RESPONSE_BYTES) return undecided("response-too-large", replied);

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return undecided("invalid-response", replied);
  }

  if (systemOne) {
    const answer = parseSystemOneEvaluation(payload);
    if (answer.status !== "ok") return undecided("invalid-response", replied);
    // Through the same threshold as a language model's answer. A decision engine is faster and
    // better shaped for the question; it is not more authoritative, and the clause's own
    // `minimumConfidence` is the reader's statement about how sure is sure enough.
    return {
      decision: resolveSemanticDecision(clause, {
        confidence: answer.confidence,
        decision: answer.matched ? "match" : "no-match",
        rationale: "",
      }),
      durationMs: elapsed(startedAt),
      ...replied,
    };
  }

  const parsed = parseSemanticEvaluation(payload);
  if (parsed.status !== "ok") return undecided("invalid-response", replied);

  return {
    decision: resolveSemanticDecision(clause, parsed.evaluation),
    durationMs: elapsed(startedAt),
    ...replied,
  };
}

/**
 * What the reader is told when a clause could not be decided here.
 *
 * Each one names something they can change, because every refusal above is a configuration or a
 * network state rather than a fault to report.
 */
export function deviceSemanticRefusalExplanation(refusal: DeviceSemanticRefusal): string {
  switch (refusal) {
    case "endpoint-invalid":
      return "That model address cannot be used. It needs a host Relay can reach, no query string, and no username or password in the URL.";
    case "endpoint-unreachable":
      return "Relay could not reach your model. If it runs on your home network, this only works while your phone is on that network.";
    case "invalid-response":
      return "Your model replied with something that was not a decision. Asking it for JSON output, or a different model, usually fixes this.";
    case "not-configured":
      return "No model is set up on this phone yet, so rules that ask a model cannot be decided here.";
    case "rejected":
      return "Your model refused the request. If it needs a key, check the one saved on this phone.";
    case "response-too-large":
      return "Your model replied with far more than a decision, so Relay ignored it.";
    case "timed-out":
      return "Your model did not answer in time, so nothing was changed.";
  }
}

/**
 * The status a refusing server sent, read as the thing a reader can act on.
 *
 * `rejected` on its own sends a reader to check a key. A 404 means the address is wrong -- most
 * often a decision engine asked at a chat route or the reverse -- and a key change would never fix
 * it, so the status is worth the sentence.
 */
export function deviceSemanticStatusExplanation(statusCode: number): string | undefined {
  if (statusCode === 401 || statusCode === 403) {
    return "The server answered that the key was missing or not accepted.";
  }
  if (statusCode === 404) {
    return "The server has no route at that address. Check the address ends in /v1, and that the kind of model matches the server: a decision engine answers at /systemone, a chat model at /chat/completions.";
  }
  if (statusCode === 422 || statusCode === 400) {
    return "The server could not accept the request as sent. The model name is the usual cause.";
  }
  if (statusCode === 429) return "The server is rate-limiting this key.";
  if (statusCode >= 500) return "The server itself failed. Trying again later usually works.";
  return undefined;
}

/** A refusal and, where a reply arrived, what its status says, in one statement. */
export function deviceSemanticResultExplanation(result: DeviceSemanticResult): string | undefined {
  if (result.refusal === undefined) return undefined;
  const base = deviceSemanticRefusalExplanation(result.refusal);
  const status =
    result.statusCode === undefined
      ? undefined
      : deviceSemanticStatusExplanation(result.statusCode);
  return status === undefined ? base : `${base} ${status}`;
}
