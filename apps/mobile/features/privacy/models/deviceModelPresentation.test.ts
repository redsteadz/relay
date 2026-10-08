import { describe, expect, it } from "vitest";

import {
  deviceModelBaseUrlError,
  deviceModelConfigFrom,
  deviceModelError,
  deviceModelFormDefaults,
  deviceModelFormError,
  deviceModelKeyError,
  deviceModelSummary,
  DEVICE_MODEL_PRESETS,
  type DeviceModelFormValues,
} from "./deviceModelPresentation";

function values(overrides: Partial<DeviceModelFormValues> = {}): DeviceModelFormValues {
  return {
    apiKey: "",
    baseUrl: "http://192.168.1.10:11434/v1",
    model: "llama3.2:3b",
    responseFormat: "json-object",
    ...overrides,
  };
}

describe("the address a model answers at", () => {
  // The point of the whole feature: a model on the reader's own network is the normal case, not an
  // exception to be argued with.
  it.each([
    "http://192.168.1.10:11434/v1",
    "http://127.0.0.1:11434/v1",
    "http://10.0.0.5:8080/v1",
    "http://desktop.local:11434/v1",
    "https://api.openai.com/v1",
  ])("accepts %s", (baseUrl) => {
    expect(deviceModelBaseUrlError(baseUrl)).toBeUndefined();
  });

  // Every message has to name what to change. A validator that says "invalid URL" for a key in the
  // address leaves a reader guessing at the one thing they must not do.
  it("says to move a key out of the address", () => {
    expect(deviceModelBaseUrlError("http://user:secret@192.168.1.10:11434/v1")).toContain(
      "its own field",
    );
  });

  it("says to drop a query string", () => {
    expect(deviceModelBaseUrlError("http://192.168.1.10:11434/v1?api-key=x")).toContain(
      "after the path",
    );
  });

  it("explains that plain http is only for a local model", () => {
    expect(deviceModelBaseUrlError("http://api.openai.com/v1")).toContain("your own network");
  });

  it("asks for a complete address rather than reporting a parse failure", () => {
    expect(deviceModelBaseUrlError("192.168.1.10:11434")).toContain("complete address");
  });

  it("asks for something rather than nothing", () => {
    expect(deviceModelBaseUrlError("   ")).toContain("Enter where your model answers");
  });

  // The form is the last check before the evaluator, so anything it accepts the evaluator must
  // accept too. Every preset is therefore usable as shipped.
  it.each(DEVICE_MODEL_PRESETS.map((preset) => [preset.label, preset] as const))(
    "ships %s as a usable preset",
    (_label, preset) => {
      expect(deviceModelFormError({ apiKey: "", ...preset })).toBeUndefined();
    },
  );
});

describe("the model and the optional key", () => {
  it("requires a model identifier", () => {
    expect(deviceModelError("")).toContain("Enter the model identifier");
    expect(deviceModelError("llama3.2:3b")).toBeUndefined();
  });

  // A local server usually needs no key, so requiring one would block the configuration this
  // feature exists for.
  it("treats a blank key as a real configuration", () => {
    expect(deviceModelKeyError("")).toBeUndefined();
    expect(deviceModelConfigFrom(values({ apiKey: "" })).apiKey).toBeUndefined();
  });

  it("refuses a key with whitespace in it", () => {
    expect(deviceModelKeyError("has space")).toContain("spaces or line breaks");
  });

  it("trims what it stores", () => {
    const config = deviceModelConfigFrom(
      values({ apiKey: "  k  ", baseUrl: "  http://10.0.0.5:8080/v1 ", model: " llama3.2:3b " }),
    );
    expect(config).toStrictEqual({
      apiKey: "k",
      baseUrl: "http://10.0.0.5:8080/v1",
      model: "llama3.2:3b",
      responseFormat: "json-object",
    });
  });
});

describe("what the panel says", () => {
  // A key field that shows a stored key invites it into a screenshot, and blank-means-keep is the
  // same convention the server panel uses.
  it("never prefills the key", () => {
    expect(
      deviceModelFormDefaults({
        apiKey: "stored-key",
        baseUrl: "http://10.0.0.5:8080/v1",
        model: "llama3.2:3b",
        responseFormat: "json-object",
      }).apiKey,
    ).toBe("");
  });

  it("defaults to the format a local server is likeliest to support", () => {
    expect(deviceModelFormDefaults(undefined).responseFormat).toBe("json-object");
  });

  // The summary names where data would go, because that is the question a privacy screen is for.
  it("names the host rather than reporting that something is set", () => {
    const summary = deviceModelSummary({
      baseUrl: "http://192.168.1.10:11434/v1",
      model: "llama3.2:3b",
      responseFormat: "json-object",
    });
    expect(summary).toContain("llama3.2:3b");
    expect(summary).toContain("192.168.1.10");
    expect(summary).toContain("never leaves");
  });

  it("says plainly when nothing is configured", () => {
    expect(deviceModelSummary(undefined)).toContain("No model on this phone");
  });
});
