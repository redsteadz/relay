import { openAiCredentialSubmitRequestSchema } from "@relay/contracts";
import { describe, expect, it } from "vitest";

import { RelayApiError } from "@/lib/relay-api";

import {
  openAiApiKeyError,
  openAiBaseUrlError,
  openAiCredentialErrorMessage,
  openAiEndpointPresets,
  openAiEndpointSummary,
  openAiKeyFormDefaults,
  openAiModelError,
  openAiPanelMeta,
  openAiPreset,
  openAiPresetForBaseUrl,
  openAiSubmitRequest,
  openAiValuesForPreset,
  type OpenAiKeyFormValues,
} from "./openAiPresentation";

const baseValues: OpenAiKeyFormValues = {
  apiKey: "sk-synthetic",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  presetId: "openai",
  responseFormat: "json-schema",
};

describe("endpoint presets", () => {
  it("keeps every non-custom preset usable as-is", () => {
    for (const preset of openAiEndpointPresets) {
      if (preset.id === "custom") continue;
      expect(openAiBaseUrlError(preset.baseUrl), preset.id).toBeUndefined();
      expect(openAiModelError(preset.model), preset.id).toBeUndefined();
    }
  });

  it("asks only OpenAI for strict schema enforcement", () => {
    // Every other endpoint may reject the stricter field outright, which would fail every request.
    for (const preset of openAiEndpointPresets) {
      expect(preset.responseFormat, preset.id).toBe(
        preset.id === "openai" ? "json-schema" : "json-object",
      );
    }
  });

  it("marks only the loopback preset as local", () => {
    const local = openAiEndpointPresets.filter((preset) => preset.localOnly);
    expect(local.map((preset) => preset.id)).toEqual(["ollama"]);
    expect(local[0]?.baseUrl).toContain("127.0.0.1");
  });

  it("falls back to custom for an unknown preset id", () => {
    expect(openAiPreset("nope" as never).id).toBe("custom");
  });
});

describe("openAiPresetForBaseUrl", () => {
  it("recognises each preset it produced", () => {
    for (const preset of openAiEndpointPresets) {
      if (preset.id === "custom") continue;
      expect(openAiPresetForBaseUrl(preset.baseUrl)).toBe(preset.id);
    }
  });

  it("ignores a trailing slash, which the server strips when storing", () => {
    expect(openAiPresetForBaseUrl("https://api.deepseek.com/v1/")).toBe("deepseek");
  });

  it("treats an unlisted endpoint as custom and an absent one as OpenAI", () => {
    expect(openAiPresetForBaseUrl("https://gateway.example.test/v1")).toBe("custom");
    expect(openAiPresetForBaseUrl(undefined)).toBe("openai");
    expect(openAiPresetForBaseUrl("   ")).toBe("openai");
  });

  it("does not match the empty custom base URL against a blank input", () => {
    expect(openAiPresetForBaseUrl("")).toBe("openai");
  });
});

describe("openAiKeyFormDefaults", () => {
  it("never prefills key material", () => {
    expect(openAiKeyFormDefaults(undefined).apiKey).toBe("");
    expect(
      openAiKeyFormDefaults({
        configured: true,
        endpoint: { baseUrl: "https://api.deepseek.com/v1" },
        provider: "openai",
      }).apiKey,
    ).toBe("");
  });

  it("reopens on the stored endpoint so replacing a key does not move the provider", () => {
    const defaults = openAiKeyFormDefaults({
      configured: true,
      endpoint: {
        baseUrl: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-sonnet-4",
        responseFormat: "json-object",
      },
      provider: "openai",
    });
    expect(defaults).toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4",
      presetId: "openrouter",
      responseFormat: "json-object",
    });
  });

  it("fills a stored endpoint's missing fields from its preset", () => {
    const defaults = openAiKeyFormDefaults({
      configured: true,
      endpoint: { baseUrl: "https://api.groq.com/openai/v1" },
      provider: "openai",
    });
    expect(defaults.model).toBe("llama-3.3-70b-versatile");
    expect(defaults.responseFormat).toBe("json-object");
  });

  it("starts an unconfigured account on OpenAI", () => {
    expect(openAiKeyFormDefaults({ configured: false, provider: "openai" })).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      presetId: "openai",
    });
  });
});

describe("openAiValuesForPreset", () => {
  it("keeps a typed key while swapping the endpoint", () => {
    const next = openAiValuesForPreset("deepseek", { ...baseValues, apiKey: "typed-already" });
    expect(next).toEqual({
      apiKey: "typed-already",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      presetId: "deepseek",
      responseFormat: "json-object",
    });
  });

  it("leaves the fields alone when switching to custom", () => {
    const next = openAiValuesForPreset("custom", baseValues);
    expect(next).toEqual({ ...baseValues, presetId: "custom" });
  });
});

describe("field validation", () => {
  it.each([
    ["an empty key", "", "Enter the key"],
    ["a key with an inner space", "sk live key", "Remove any spaces"],
    ["a key with a newline", "sk-synthetic\nx", "Remove any spaces"],
  ])("rejects %s", (_name, value, fragment) => {
    expect(openAiApiKeyError(value)).toContain(fragment);
  });

  it("accepts a short placeholder, which local servers use", () => {
    expect(openAiApiKeyError("ollama")).toBeUndefined();
  });

  it("accepts a key that only needs trimming", () => {
    expect(openAiApiKeyError("  sk-synthetic  ")).toBeUndefined();
  });

  it("rejects a key past the contract ceiling", () => {
    expect(openAiApiKeyError(`sk-${"x".repeat(600)}`)).toContain("512");
  });

  it.each([
    ["an empty URL", "", "Enter the endpoint"],
    ["a bare host", "api.openai.com", "complete URL"],
    ["a non-http scheme", "ftp://gateway.example.test/v1", "https://"],
    [
      "embedded credentials",
      "https://user:secret@gateway.example.test/v1",
      "username and password",
    ],
    ["a query string", "https://gateway.example.test/v1?key=secret", "after the path"],
    ["a fragment", "https://gateway.example.test/v1#token", "after the path"],
  ])("rejects %s as a base URL", (_name, value, fragment) => {
    expect(openAiBaseUrlError(value)).toContain(fragment);
  });

  it("leaves plain http to the server, which allows it for a local model in development", () => {
    expect(openAiBaseUrlError("http://127.0.0.1:11434/v1")).toBeUndefined();
  });

  it("accepts an empty model, which falls back to the deployment default", () => {
    expect(openAiModelError("")).toBeUndefined();
  });

  it("accepts a namespaced gateway model", () => {
    expect(openAiModelError("meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBeUndefined();
  });

  it("rejects a model identifier with a space", () => {
    expect(openAiModelError("gpt 4")).toContain("model identifier");
  });
});

describe("openAiSubmitRequest", () => {
  it("trims a pasted key", () => {
    expect(openAiSubmitRequest({ ...baseValues, apiKey: "  sk-synthetic\n" }).apiKey).toBe(
      "sk-synthetic",
    );
  });

  it("omits a blank model instead of sending an empty string", () => {
    const request = openAiSubmitRequest({ ...baseValues, model: "   " });
    expect(request.endpoint).toEqual({
      baseUrl: "https://api.openai.com/v1",
      responseFormat: "json-schema",
    });
  });

  it("always names the endpoint, so the choice travels with the credential", () => {
    const request = openAiSubmitRequest(baseValues);
    expect(request.endpoint?.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("produces a body the API accepts, for every preset", () => {
    // The submit schema is strict, so this is what stops the form and the route drifting apart:
    // an extra or misnamed field here would be a 400 on the device with no other warning.
    for (const preset of openAiEndpointPresets) {
      const values: OpenAiKeyFormValues = {
        apiKey: "sk-synthetic",
        baseUrl: preset.id === "custom" ? "https://gateway.example.test/v1" : preset.baseUrl,
        model: preset.model,
        presetId: preset.id,
        responseFormat: preset.responseFormat,
      };
      const parsed = openAiCredentialSubmitRequestSchema.safeParse(openAiSubmitRequest(values));
      expect(parsed.success, preset.id).toBe(true);
    }
  });

  it("produces a body the API accepts when the model is left blank", () => {
    const parsed = openAiCredentialSubmitRequestSchema.safeParse(
      openAiSubmitRequest({ ...baseValues, model: "" }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("openAiCredentialErrorMessage", () => {
  it.each([
    ["openai_key_rejected", "refused this key"],
    ["openai_endpoint_invalid", "will not send data"],
    ["openai_already_configured", "Replace key"],
    ["openai_validation_unavailable", "could not reach that endpoint"],
    ["invalid_openai_key", "could not be read"],
    ["openai_not_found", "no stored key"],
    ["openai_not_configured", "not configured"],
  ])("explains %s", (apiCode, fragment) => {
    const error = new RelayApiError("validation", { apiCode });
    expect(openAiCredentialErrorMessage(error)).toContain(fragment);
  });

  it("separates a refused key from a refused address, which share a status", () => {
    // Both arrive as 400 and therefore as reason "validation"; only the API code tells them apart.
    const rejected = new RelayApiError("validation", { apiCode: "openai_key_rejected" });
    const invalid = new RelayApiError("validation", { apiCode: "openai_endpoint_invalid" });
    expect(openAiCredentialErrorMessage(rejected)).not.toBe(openAiCredentialErrorMessage(invalid));
  });

  it("falls back to the transport reason when no code is carried", () => {
    expect(openAiCredentialErrorMessage(new RelayApiError("unauthorized"))).toContain(
      "session expired",
    );
    expect(openAiCredentialErrorMessage(new RelayApiError("rate-limit"))).toContain("Too many");
    expect(openAiCredentialErrorMessage(new RelayApiError("network"))).toContain("unreachable");
  });

  it("never surfaces an underlying error's text", () => {
    const message = openAiCredentialErrorMessage(new Error("insufficient_quota for org-secret"));
    expect(message).not.toContain("org-secret");
    expect(message).toContain("could not be saved");
  });
});

describe("openAiPanelMeta", () => {
  it.each([
    ["Checking", true, null, undefined],
    ["Unavailable", false, new Error("down"), undefined],
    ["No key", false, null, { configured: false, provider: "openai" } as const],
    ["Active", false, null, { configured: true, provider: "openai", validated: true } as const],
    [
      "Stored, unverified",
      false,
      null,
      { configured: true, provider: "openai", validated: false } as const,
    ],
  ])("reports %s", (expected, loading, error, status) => {
    expect(openAiPanelMeta(loading, error, status)).toBe(expected);
  });

  it("treats an absent validated flag as active rather than unverified", () => {
    expect(openAiPanelMeta(false, null, { configured: true, provider: "openai" })).toBe("Active");
  });
});

describe("openAiEndpointSummary", () => {
  it("names the host and model, never a key", () => {
    expect(
      openAiEndpointSummary({ baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" }),
    ).toBe("api.deepseek.com · deepseek-chat");
  });

  it("describes the default when no endpoint is stored", () => {
    expect(openAiEndpointSummary(undefined)).toBe("OpenAI · gpt-4.1-mini");
  });

  it("degrades to the model when a stored base URL cannot be parsed", () => {
    expect(openAiEndpointSummary({ baseUrl: "::broken::", model: "local" })).toBe("local");
  });
});
