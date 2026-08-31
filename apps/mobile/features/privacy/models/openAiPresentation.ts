/**
 * Presentation logic for the semantic-processing credential panel.
 *
 * Everything here is pure so it can be tested without rendering: the components in this feature
 * stay thin, matching how `categoryPresentation.ts` backs the category editor.
 *
 * Field rules reuse the contract schemas rather than restating them, so the form cannot drift from
 * what the API accepts. `zod` itself is deliberately not imported -- the mobile app depends on
 * `@relay/contracts` for schema objects, not on the validator.
 */

import {
  DEFAULT_SEMANTIC_MODEL,
  MAX_SEMANTIC_DISCLOSURE_CHARACTERS,
  MAX_SEMANTIC_FIELD_CHARACTERS,
  openAiApiKeySchema,
  semanticModelSchema,
  type OpenAiCredentialStatus,
  type OpenAiCredentialSubmitRequest,
  type SemanticEndpointOverride,
  type SemanticResponseFormat,
} from "@relay/contracts";

import { RelayApiError } from "@/lib/relay-api";

export type OpenAiPresetId =
  "custom" | "deepseek" | "gemini" | "groq" | "ollama" | "openai" | "openrouter" | "together";

export type OpenAiEndpointPreset = {
  /** Empty for `custom`, where the person supplies it. */
  baseUrl: string;
  detail: string;
  id: OpenAiPresetId;
  /** True when the endpoint is only reachable from the machine running Relay. */
  localOnly: boolean;
  /** A starting point, not a requirement: accounts differ in which models they can call. */
  model: string;
  name: string;
  responseFormat: SemanticResponseFormat;
};

/** The fallback for anything unlisted: every field stays editable, so nothing is assumed. */
const CUSTOM_PRESET: OpenAiEndpointPreset = {
  baseUrl: "",
  detail: "Any other server that speaks the OpenAI chat-completions protocol.",
  id: "custom",
  localOnly: false,
  model: "",
  name: "Custom",
  responseFormat: "json-object",
};

/**
 * Endpoints known to speak the OpenAI chat-completions protocol.
 *
 * Mirrors the table in `docs/integrations/openai.md`, which is the reference. Base URLs and model
 * names come from each provider's own documentation and drift, so `custom` exists for anything not
 * listed and every field stays editable after a preset is applied.
 *
 * `json-schema` is used only for OpenAI, which enforces it. Everywhere else starts on `json-object`,
 * because a provider that rejects the stricter field would fail every request. This only changes
 * what the endpoint is asked to enforce: Relay parses every answer through the same strict contract
 * schema regardless, so a weaker setting cannot widen what Relay accepts.
 */
export const openAiEndpointPresets: readonly OpenAiEndpointPreset[] = [
  {
    baseUrl: "https://api.openai.com/v1",
    detail: "The default. Enforces structured output at the provider.",
    id: "openai",
    localOnly: false,
    model: DEFAULT_SEMANTIC_MODEL,
    name: "OpenAI",
    responseFormat: "json-schema",
  },
  {
    baseUrl: "https://api.deepseek.com/v1",
    detail: "DeepSeek's own OpenAI-compatible endpoint.",
    id: "deepseek",
    localOnly: false,
    model: "deepseek-chat",
    name: "DeepSeek",
    responseFormat: "json-object",
  },
  {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    detail: "Google's OpenAI-compatibility layer for Gemini.",
    id: "gemini",
    localOnly: false,
    model: "gemini-2.5-flash",
    name: "Gemini",
    responseFormat: "json-object",
  },
  {
    baseUrl: "https://openrouter.ai/api/v1",
    detail: "A gateway. Model names are namespaced by vendor.",
    id: "openrouter",
    localOnly: false,
    model: "anthropic/claude-sonnet-4",
    name: "OpenRouter",
    responseFormat: "json-object",
  },
  {
    baseUrl: "https://api.together.xyz/v1",
    detail: "A gateway for open-weight models.",
    id: "together",
    localOnly: false,
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    name: "Together",
    responseFormat: "json-object",
  },
  {
    baseUrl: "https://api.groq.com/openai/v1",
    detail: "A gateway for open-weight models.",
    id: "groq",
    localOnly: false,
    model: "llama-3.3-70b-versatile",
    name: "Groq",
    responseFormat: "json-object",
  },
  {
    baseUrl: "http://127.0.0.1:11434/v1",
    detail:
      "A model running on the same machine as Relay, so content never leaves it. Development builds only: a hosted Relay cannot reach your computer.",
    id: "ollama",
    localOnly: true,
    model: "llama3.3",
    name: "Local (Ollama)",
    responseFormat: "json-object",
  },
  CUSTOM_PRESET,
];

export type OpenAiKeyFormValues = {
  apiKey: string;
  baseUrl: string;
  model: string;
  presetId: OpenAiPresetId;
  responseFormat: SemanticResponseFormat;
};

export function openAiPreset(id: OpenAiPresetId): OpenAiEndpointPreset {
  return openAiEndpointPresets.find((preset) => preset.id === id) ?? CUSTOM_PRESET;
}

/** Which preset a stored base URL came from, so reopening the form shows the same choice. */
export function openAiPresetForBaseUrl(baseUrl: string | undefined): OpenAiPresetId {
  if (baseUrl === undefined || baseUrl.trim().length === 0) return "openai";
  const normalized = baseUrl.trim().replace(/\/+$/u, "");
  const match = openAiEndpointPresets.find(
    (preset) => preset.baseUrl.length > 0 && preset.baseUrl === normalized,
  );
  return match?.id ?? "custom";
}

/**
 * Starting values for the form.
 *
 * The stored endpoint is prefilled when one exists so replacing a key does not silently move it to a
 * different provider. The key itself is never prefilled: Relay does not return stored key material,
 * and the field starts empty on every open.
 */
export function openAiKeyFormDefaults(
  status: OpenAiCredentialStatus | undefined,
): OpenAiKeyFormValues {
  const endpoint = status?.endpoint;
  const presetId = openAiPresetForBaseUrl(endpoint?.baseUrl);
  const preset = openAiPreset(presetId);
  return {
    apiKey: "",
    baseUrl: endpoint?.baseUrl ?? preset.baseUrl,
    model: endpoint?.model ?? preset.model,
    presetId,
    responseFormat: endpoint?.responseFormat ?? preset.responseFormat,
  };
}

/** Applies a preset, keeping whatever key has already been typed. */
export function openAiValuesForPreset(
  presetId: OpenAiPresetId,
  current: OpenAiKeyFormValues,
): OpenAiKeyFormValues {
  const preset = openAiPreset(presetId);
  if (presetId === "custom") {
    return { ...current, presetId };
  }
  return {
    apiKey: current.apiKey,
    baseUrl: preset.baseUrl,
    model: preset.model,
    presetId,
    responseFormat: preset.responseFormat,
  };
}

export function openAiApiKeyError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) return "Enter the key issued by your provider.";
  if (!openAiApiKeySchema.safeParse(candidate).success) {
    return "Remove any spaces or line breaks from the key, and keep it under 512 characters.";
  }
  return undefined;
}

/**
 * A first-pass check on the base URL, not the security boundary.
 *
 * The authoritative rule lives in `packages/domain/src/semantic-endpoint.ts` and runs on the server
 * before anything is stored or sent; this only spares an obviously wrong URL a round trip. Plain
 * `http` is deliberately not refused here, because the server accepts it for a loopback address in a
 * development build, which is how a locally hosted model is reached.
 */
export function openAiBaseUrlError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) return "Enter the endpoint base URL, usually ending in /v1.";
  if (candidate.length > 2048) return "That URL is too long.";
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return "Enter a complete URL, including https://.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Use an https:// URL.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Remove the username and password from the URL. Relay sends the key as a header.";
  }
  if (url.search !== "" || url.hash !== "") {
    return "Remove anything after the path. A key in the URL would reach logs; Relay sends it as a header.";
  }
  return undefined;
}

export function openAiModelError(value: string): string | undefined {
  const candidate = value.trim();
  if (candidate.length === 0) return undefined;
  if (!semanticModelSchema.safeParse(candidate).success) {
    return "Use the model identifier from your provider, such as deepseek-chat.";
  }
  return undefined;
}

export function openAiFormError(values: OpenAiKeyFormValues): string | undefined {
  return (
    openAiApiKeyError(values.apiKey) ??
    openAiBaseUrlError(values.baseUrl) ??
    openAiModelError(values.model)
  );
}

/**
 * The request body for a valid form.
 *
 * The endpoint is always sent explicitly, including for OpenAI, so the choice travels with the
 * credential instead of following whatever default the deployment happens to carry. An empty model
 * is omitted rather than sent blank, leaving the deployment default to apply.
 */
export function openAiSubmitRequest(values: OpenAiKeyFormValues): OpenAiCredentialSubmitRequest {
  const model = values.model.trim();
  return {
    apiKey: values.apiKey.trim(),
    endpoint: {
      baseUrl: values.baseUrl.trim(),
      responseFormat: values.responseFormat,
      ...(model.length === 0 ? {} : { model }),
    },
  };
}

const CREDENTIAL_MESSAGES: Readonly<Record<string, string>> = {
  invalid_openai_key:
    "That key could not be read. Paste it again without spaces or line breaks around it.",
  openai_already_configured: "A key is already stored. Use Replace key to change it.",
  openai_credential_unavailable: "Relay could not save the key just now. Try again shortly.",
  openai_endpoint_invalid:
    "Relay will not send data to that address. Use an https:// URL for a public host; a local address works only in a development build.",
  openai_key_rejected:
    "The endpoint refused this key. Check that it is active and belongs to the provider you selected.",
  openai_not_configured: "Semantic processing is not configured on this Relay deployment.",
  openai_not_found: "There is no stored key to replace. Add one instead.",
  openai_validation_unavailable:
    "Relay could not reach that endpoint to check the key. Confirm the base URL, then try again.",
};

/**
 * A message that says what to do next.
 *
 * The API's own error code is preferred over the coarse failure reason, because every 4xx collapses
 * to `validation` and a person needs to know whether it was the key, the address, or an existing
 * credential. Provider text is never surfaced: only Relay's fixed codes reach here.
 */
export function openAiCredentialErrorMessage(error: unknown): string {
  if (error instanceof RelayApiError) {
    const message = error.apiCode === undefined ? undefined : CREDENTIAL_MESSAGES[error.apiCode];
    if (message !== undefined) return message;
    if (error.reason === "unauthorized") return "Your session expired. Sign in again to continue.";
    if (error.reason === "rate-limit") {
      return "Too many attempts. Wait a moment before trying again.";
    }
    if (error.reason === "network" || error.reason === "timeout") {
      return "Relay is temporarily unreachable. Check your connection and try again.";
    }
    if (error.reason === "not-configured") {
      return "Semantic processing is not configured on this Relay deployment.";
    }
  }
  return "The key could not be saved right now. Try again shortly.";
}

export function openAiPanelMeta(
  loading: boolean,
  error: unknown,
  status: OpenAiCredentialStatus | undefined,
): string {
  if (loading) return "Checking";
  if (error !== null && error !== undefined) return "Unavailable";
  if (status?.configured !== true) return "No key";
  return status.validated === false ? "Stored, unverified" : "Active";
}

/** Host and model for the configured endpoint. Never the key, which Relay does not return. */
export function openAiEndpointSummary(endpoint: SemanticEndpointOverride | undefined): string {
  const model = endpoint?.model ?? DEFAULT_SEMANTIC_MODEL;
  const baseUrl = endpoint?.baseUrl;
  if (baseUrl === undefined || baseUrl.trim().length === 0) return `OpenAI · ${model}`;
  try {
    return `${new URL(baseUrl).host} · ${model}`;
  } catch {
    return model;
  }
}

/**
 * What semantic evaluation may send, shown before a key is added.
 *
 * Stated as rules rather than a field list because the fields are per-clause: each compiled filter
 * names its own allowlist, and nothing outside that list is read.
 */
export const semanticDisclosureRules: readonly string[] = [
  "Deterministic filters run first. A clause only reaches a model when they cannot decide it.",
  "Only the fields a filter names in its own allowlist are read. Nothing else is sent.",
  `Each field is cut to ${MAX_SEMANTIC_FIELD_CHARACTERS.toLocaleString()} characters and the whole request to ${MAX_SEMANTIC_DISCLOSURE_CHARACTERS.toLocaleString()}.`,
  "Relay decides the outcome. An answer below the filter's confidence threshold stays undecided.",
  "Every attempt is recorded with the field names, the model, and the host reached — never the text.",
];

/** Value classes removed before a field is sent, matching `semanticRedactionKindSchema`. */
export const semanticRedactionClasses: readonly string[] = [
  "Email addresses",
  "Links",
  "Key-shaped tokens",
  "Payment cards",
  "Phone numbers",
  "Long digit runs",
];
