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
 */

import {
  deviceSemanticConfigSchema,
  type DeviceSemanticConfig,
  type FilterPlan,
  type SemanticDisclosure,
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
  refusal?: DeviceSemanticRefusal;
};

/** How long the reader waits before a notification is left alone. */
export const DEVICE_SEMANTIC_TIMEOUT_MS = 8_000;

function undecided(refusal: DeviceSemanticRefusal): DeviceSemanticResult {
  return { decision: "undecided", refusal };
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
  const parsedConfig = deviceSemanticConfigSchema.safeParse(config);
  if (!parsedConfig.success) return undecided("not-configured");
  const settings: DeviceSemanticConfig = parsedConfig.data;

  // The device is on the network it is asking about and is making a request its owner configured,
  // so a LAN address is the point rather than an SSRF risk. Every server-side caller keeps the
  // strict policy; this is the same parser with a different argument.
  const endpoint = parseSemanticBaseUrl(settings.baseUrl, { allowLocalNetwork: true });
  if (endpoint === undefined) return undecided("endpoint-invalid");

  // Minimization happens once, before either protocol sees anything. What leaves the device is
  // decided by the clause's allowlist and the redactions, never by the wire format.
  const disclosure = minimizeSemanticDisclosure(clause, item);
  const systemOne = settings.protocol === "system-one";
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
    return {
      ...undecided(controller.signal.aborted ? "timed-out" : "endpoint-unreachable"),
      disclosure: sent,
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return { ...undecided("rejected"), disclosure: sent };

  const text = await response.text();
  // Bounded before parsing. A reply larger than this is not a decision whatever it claims to be,
  // and a local endpoint is exactly where an accidental model dump would arrive from.
  if (text.length > MAX_SEMANTIC_RESPONSE_BYTES) {
    return { ...undecided("response-too-large"), disclosure: sent };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return { ...undecided("invalid-response"), disclosure: sent };
  }

  if (systemOne) {
    const answer = parseSystemOneEvaluation(payload);
    if (answer.status !== "ok") return { ...undecided("invalid-response"), disclosure: sent };
    // Through the same threshold as a language model's answer. A decision engine is faster and
    // better shaped for the question; it is not more authoritative, and the clause's own
    // `minimumConfidence` is the reader's statement about how sure is sure enough.
    return {
      decision: resolveSemanticDecision(clause, {
        confidence: answer.confidence,
        decision: answer.matched ? "match" : "no-match",
        rationale: "",
      }),
      disclosure: sent,
    };
  }

  const parsed = parseSemanticEvaluation(payload);
  if (parsed.status !== "ok") return { ...undecided("invalid-response"), disclosure: sent };

  return {
    decision: resolveSemanticDecision(clause, parsed.evaluation),
    disclosure: sent,
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
 * Every refusal this build knows, so a stored one can be narrowed before it is explained.
 *
 * A disclosure row outlives the build that wrote it, and a refusal this build has no name for is
 * not an error -- it is a row from a newer or older version. Narrowing here rather than casting is
 * what keeps `deviceSemanticRefusalExplanation` exhaustive and its switch a compile error when a
 * refusal is added.
 */
const DEVICE_SEMANTIC_REFUSALS: ReadonlySet<string> = new Set<DeviceSemanticRefusal>([
  "endpoint-invalid",
  "endpoint-unreachable",
  "invalid-response",
  "not-configured",
  "rejected",
  "response-too-large",
  "timed-out",
]);

/** The explanation for a refusal as it was stored, or nothing when there is none to give. */
export function storedRefusalExplanation(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || !DEVICE_SEMANTIC_REFUSALS.has(value))
    return undefined;
  return deviceSemanticRefusalExplanation(value as DeviceSemanticRefusal);
}

/**
 * What one test request against a configured endpoint did.
 *
 * `httpStatus` is the whole point. Every ordinary misconfiguration collapses to the same
 * `rejected` outcome on the evaluation path -- a wrong path, a wrong key and a wrong request shape
 * are indistinguishable once the reader only sees "your model refused the request" -- and the
 * status code separates them without carrying anything from the response body.
 */
export type DeviceSemanticProbe = {
  decided: boolean;
  httpStatus?: number;
  refusal?: DeviceSemanticRefusal;
};

/**
 * The clause a test request asks about.
 *
 * Synthetic and fixed. A probe exists to find out whether the endpoint answers at all, and asking
 * it about a real capture would disclose one to an address that has not been shown to work yet --
 * which is the one thing a reader testing an address has not yet agreed to.
 */
const PROBE_CLAUSE: SemanticClause = {
  allowedFields: ["subject"],
  minimumConfidence: 0.8,
  question: "Is this message about a parcel delivery?",
};

const PROBE_ITEM: Record<string, unknown> = {
  "source.kind": "notification",
  subject: "Your parcel is out for delivery",
};

/**
 * Sends one request to the configured endpoint and reports what came back.
 *
 * Deliberately a separate path from `evaluateDeviceSemanticClause` rather than a flag on it. That
 * function's contract is that every failure is `undecided` and nothing but the refusal escapes,
 * which is right when a notification is at stake and wrong when a person is asking "why does this
 * not work". Here the status code is the answer.
 *
 * Never throws, for the same reason the evaluator does not.
 */
export async function probeDeviceSemanticEndpoint(
  config: unknown,
  options: {
    fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
  } = {},
): Promise<DeviceSemanticProbe> {
  const parsedConfig = deviceSemanticConfigSchema.safeParse(config);
  if (!parsedConfig.success) return { decided: false, refusal: "not-configured" };
  const settings = parsedConfig.data;

  const endpoint = parseSemanticBaseUrl(settings.baseUrl, { allowLocalNetwork: true });
  if (endpoint === undefined) return { decided: false, refusal: "endpoint-invalid" };

  const systemOne = settings.protocol === "system-one";
  const disclosure = minimizeSemanticDisclosure(PROBE_CLAUSE, PROBE_ITEM);
  const body = systemOne
    ? systemOneRequestBody(PROBE_CLAUSE, disclosure, { model: settings.model })
    : semanticEvaluationRequestBody(PROBE_CLAUSE, disclosure, {
        model: settings.model,
        responseFormat: settings.responseFormat,
      });

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEVICE_SEMANTIC_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetcher(
      `${endpoint.baseUrl}${systemOne ? "/systemone" : "/chat/completions"}`,
      {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey === undefined ? {} : { authorization: `Bearer ${settings.apiKey}` }),
        },
        method: "POST",
        signal: controller.signal,
      },
    );
  } catch {
    return {
      decided: false,
      refusal: controller.signal.aborted ? "timed-out" : "endpoint-unreachable",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return { decided: false, httpStatus: response.status, refusal: "rejected" };

  const text = await response.text();
  if (text.length > MAX_SEMANTIC_RESPONSE_BYTES) {
    return { decided: false, httpStatus: response.status, refusal: "response-too-large" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return { decided: false, httpStatus: response.status, refusal: "invalid-response" };
  }

  const understood = systemOne
    ? parseSystemOneEvaluation(payload).status === "ok"
    : parseSemanticEvaluation(payload).status === "ok";
  return understood
    ? { decided: true, httpStatus: response.status }
    : { decided: false, httpStatus: response.status, refusal: "invalid-response" };
}

/**
 * The probe in the words a reader can act on.
 *
 * A status code names the problem precisely enough to fix it, which the generic refusal text
 * cannot: 404 means the path is wrong and not that the model refused anything, and a gateway whose
 * base is `/api/v1` rather than `/v1` is the common way to arrive at one.
 */
export function deviceSemanticProbeExplanation(probe: DeviceSemanticProbe): string {
  if (probe.decided) return "That model answered correctly. Rules that ask a model can use it.";

  switch (probe.httpStatus) {
    case undefined:
      break;
    case 401:
    case 403:
      return `Your model rejected the key (HTTP ${probe.httpStatus}). The address is right; the credential is not.`;
    case 404:
      return "Nothing answers at that address (HTTP 404). The host is reachable but the path is wrong -- some gateways answer under /api/v1 rather than /v1.";
    case 400:
    case 422:
      return `Your model refused the request shape (HTTP ${probe.httpStatus}). The address and key are right, so this is usually the wrong model name for this endpoint, or the wrong kind of model selected above.`;
    case 429:
      return "Your model is rate limiting this device (HTTP 429). Nothing is wrong with the settings.";
    default:
      if (probe.httpStatus >= 500) {
        return `Your model's server failed (HTTP ${probe.httpStatus}). The settings look right; the endpoint did not.`;
      }
      return `Your model refused the request (HTTP ${probe.httpStatus}).`;
  }

  return probe.refusal === undefined
    ? "That model did not answer."
    : deviceSemanticRefusalExplanation(probe.refusal);
}
