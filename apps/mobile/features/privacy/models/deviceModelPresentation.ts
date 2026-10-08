import {
  deviceSemanticConfigSchema,
  openAiApiKeySchema,
  semanticModelSchema,
  type DeviceSemanticConfig,
  type SemanticResponseFormat,
} from "@relay/contracts";
import { parseSemanticBaseUrl } from "@relay/domain";

/**
 * The model this phone asks, as the privacy screen presents it.
 *
 * Validation here uses the real parser rather than a looser first pass, which is the opposite of the
 * choice `openAiPresentation` makes for the server endpoint. There it is reasonable: the server
 * validates again before sending, so the form only has to be helpful. Here the form *is* the last
 * check before the evaluator, and a form that accepts an address the evaluator then refuses would
 * tell a reader their model is configured when no rule will ever be decided.
 *
 * See [ADR-0019](../../../../docs/decisions/0019-device-semantic-evaluation.md).
 */
export type DeviceModelFormValues = {
  apiKey: string;
  baseUrl: string;
  model: string;
  responseFormat: SemanticResponseFormat;
};

/** Where a locally hosted model usually answers, so the common cases are not typed from memory. */
export const DEVICE_MODEL_PRESETS: readonly {
  baseUrl: string;
  id: string;
  label: string;
  model: string;
  responseFormat: SemanticResponseFormat;
}[] = [
  {
    baseUrl: "http://127.0.0.1:11434/v1",
    id: "ollama-local",
    label: "Ollama on this phone",
    model: "llama3.2:3b",
    responseFormat: "json-object",
  },
  {
    baseUrl: "http://192.168.1.10:11434/v1",
    id: "ollama-lan",
    label: "Ollama on my computer",
    model: "llama3.2:3b",
    responseFormat: "json-object",
  },
  {
    baseUrl: "http://192.168.1.10:1234/v1",
    id: "lm-studio",
    label: "LM Studio",
    model: "local-model",
    responseFormat: "json-object",
  },
];

export function deviceModelFormDefaults(
  config: DeviceSemanticConfig | undefined,
): DeviceModelFormValues {
  return {
    // Never prefilled, even though this device holds it: a field that shows a key invites it into a
    // screenshot, and leaving it blank on an edit means "keep what is stored".
    apiKey: "",
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? "",
    responseFormat: config?.responseFormat ?? "json-object",
  };
}

/**
 * The authoritative check, in the words a reader can act on.
 *
 * Each message names what to change rather than restating the rule, because every rejection here is
 * a URL someone typed.
 */
export function deviceModelBaseUrlError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) {
    return "Enter where your model answers, usually ending in /v1.";
  }
  if (candidate.length > 2048) return "That address is too long.";
  if (parseSemanticBaseUrl(candidate, { allowLocalNetwork: true }) !== undefined) {
    return undefined;
  }

  // Distinguish the two rejections a reader actually hits, so the message is about their mistake.
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return "Enter a complete address, including http:// or https://.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Remove the username and password from the address. A key goes in its own field.";
  }
  if (url.search !== "" || url.hash !== "") {
    return "Remove anything after the path — no ? or # in the address.";
  }
  if (url.protocol === "http:") {
    return "Plain http:// only works for a model on your own network or this phone. Use https:// for anything else.";
  }
  return "Relay cannot use that address.";
}

export function deviceModelError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) return "Enter the model identifier, such as llama3.2:3b.";
  if (!semanticModelSchema.safeParse(candidate).success) {
    return "Use the identifier your model server reports, such as llama3.2:3b.";
  }
  return undefined;
}

/** A key is optional: the common local case has none, and requiring one would block it. */
export function deviceModelKeyError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) return undefined;
  if (!openAiApiKeySchema.safeParse(candidate).success) {
    return "Remove any spaces or line breaks from the key.";
  }
  return undefined;
}

export function deviceModelFormError(values: DeviceModelFormValues): string | undefined {
  return (
    deviceModelBaseUrlError(values.baseUrl) ??
    deviceModelError(values.model) ??
    deviceModelKeyError(values.apiKey)
  );
}

/**
 * The form as the contract wants it.
 *
 * A blank key means "no key", which is a real configuration rather than a missing field, so it is
 * omitted rather than stored empty.
 */
export function deviceModelConfigFrom(values: DeviceModelFormValues): DeviceSemanticConfig {
  const apiKey = values.apiKey.trim();
  return deviceSemanticConfigSchema.parse({
    ...(apiKey === "" ? {} : { apiKey }),
    baseUrl: values.baseUrl.trim(),
    model: values.model.trim(),
    responseFormat: values.responseFormat,
  });
}

/** One line for the panel, naming where data would go rather than whether something is set. */
export function deviceModelSummary(config: DeviceSemanticConfig | undefined): string {
  if (config === undefined) {
    return "No model on this phone. Rules that ask a model wait for one.";
  }
  const host = parseSemanticBaseUrl(config.baseUrl, { allowLocalNetwork: true })?.host;
  const where = host === undefined ? config.baseUrl : host;
  return `${config.model} at ${where}. Only this phone uses it, and the key never leaves it.`;
}
