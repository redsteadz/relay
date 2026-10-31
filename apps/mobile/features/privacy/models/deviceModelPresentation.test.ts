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
    protocol: "openai",
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
      // Defaulted, so every endpoint configured before decision engines existed keeps working.
      protocol: "openai",
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
        protocol: "openai",
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
      protocol: "openai",
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

describe("choosing the kind of model", () => {
  // The two are not independent: a decision engine answers at `/systemone` and a chat model at
  // `/chat/completions`, so a preset that set an address without its protocol would point a reader
  // at a route their server does not serve.
  it("every preset declares the protocol its address speaks", () => {
    for (const preset of DEVICE_MODEL_PRESETS) {
      expect(["openai", "system-one"]).toContain(preset.protocol);
    }
    expect(DEVICE_MODEL_PRESETS.some((preset) => preset.protocol === "system-one")).toBe(true);
  });

  /*
    A gateway names a model by vendor and version; the direct endpoint names it bare. So the two
    Jev presets cannot share a model id, and a reader who reaches OpenRouter by editing the hosted
    preset's address alone carries `jev-latest` with them, which OpenRouter does not have. Each
    address keeping its own id is what makes the preset a whole answer rather than most of one.
  */
  it("gives a gateway preset the id that gateway uses", () => {
    const gateway = DEVICE_MODEL_PRESETS.find((preset) => preset.baseUrl.includes("openrouter.ai"));
    expect(gateway?.protocol).toBe("system-one");
    expect(gateway?.model).toContain("/");
    const direct = DEVICE_MODEL_PRESETS.find((preset) => preset.id === "jev");
    expect(gateway?.model).not.toBe(direct?.model);
  });

  it("carries the chosen protocol into what is stored", () => {
    expect(deviceModelConfigFrom(values({ protocol: "system-one" })).protocol).toBe("system-one");
  });

  // An endpoint saved before decision engines existed has no protocol; reading it as a chat model is
  // what keeps it working.
  it("defaults an unset protocol to the chat one", () => {
    expect(deviceModelFormDefaults(undefined).protocol).toBe("openai");
  });

  // A reader seeing no explanation on a verdict should know that is the model, not a fault.
  it("says a decision engine does not explain itself", () => {
    const summary = deviceModelSummary({
      baseUrl: "https://thejevai.com/v1",
      model: "jev-latest",
      protocol: "system-one",
      responseFormat: "json-object",
    });
    expect(summary).toContain("without explaining");
  });
});
