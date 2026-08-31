import { describe, expect, it } from "vitest";

import { parseSemanticBaseUrl } from "../src/semantic-endpoint.js";

describe("parseSemanticBaseUrl", () => {
  it.each([
    ["OpenAI", "https://api.openai.com/v1", "api.openai.com"],
    ["a gateway", "https://openrouter.ai/api/v1", "openrouter.ai"],
    ["DeepSeek", "https://api.deepseek.com/v1", "api.deepseek.com"],
    [
      "the Gemini OpenAI compatibility layer",
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "generativelanguage.googleapis.com",
    ],
    ["an Azure deployment", "https://relay.openai.azure.com/openai/v1", "relay.openai.azure.com"],
  ])("accepts %s", (_name, value, host) => {
    expect(parseSemanticBaseUrl(value)).toEqual({ baseUrl: value, host });
  });

  it("strips a trailing slash so a route composes predictably", () => {
    expect(parseSemanticBaseUrl("https://api.openai.com/v1/")?.baseUrl).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("lowercases the host, since it is recorded on every disclosure", () => {
    expect(parseSemanticBaseUrl("https://API.OpenAI.COM/v1")?.host).toBe("api.openai.com");
  });

  it.each([
    ["a private range", "https://10.0.0.5/v1"],
    ["a private 172 range", "https://172.16.4.1/v1"],
    ["a private 192.168 range", "https://192.168.1.10/v1"],
    ["cloud metadata", "https://169.254.169.254/latest"],
    ["carrier-grade NAT", "https://100.64.0.1/v1"],
    ["loopback", "https://127.0.0.1/v1"],
    ["the zero address", "https://0.0.0.0/v1"],
    ["multicast", "https://239.1.1.1/v1"],
    ["an IPv6 literal", "https://[::1]/v1"],
    ["an IPv4-mapped IPv6 literal", "https://[::ffff:169.254.169.254]/v1"],
    ["localhost", "https://localhost/v1"],
    ["a .local name", "https://models.local/v1"],
    ["an .internal name", "https://models.internal/v1"],
    ["a .home.arpa name", "https://box.home.arpa/v1"],
    ["a trailing-dot localhost", "https://localhost./v1"],
  ])("refuses %s", (_name, value) => {
    expect(parseSemanticBaseUrl(value)).toBeUndefined();
  });

  it.each([
    ["plain http to a public host", "http://api.openai.com/v1"],
    ["embedded credentials", "https://user:secret@gateway.example.test/v1"],
    // Several gateways accept a key in the query string. A base URL that can carry a credential
    // would smuggle one into every log and disclosure record naming the endpoint.
    ["a query string", "https://gateway.example.test/v1?key=secret"],
    ["a fragment", "https://gateway.example.test/v1#token"],
    ["a non-URL", "not-a-url"],
    ["an empty string", ""],
    ["a non-http scheme", "ftp://gateway.example.test/v1"],
    ["a file URL", "file:///etc/passwd"],
  ])("refuses %s", (_name, value) => {
    expect(parseSemanticBaseUrl(value)).toBeUndefined();
  });

  describe("local models", () => {
    it("accepts loopback over plain http when explicitly allowed", () => {
      expect(
        parseSemanticBaseUrl("http://127.0.0.1:11434/v1", { allowLoopbackHttp: true }),
      ).toEqual({ baseUrl: "http://127.0.0.1:11434/v1", host: "127.0.0.1" });
    });

    it("accepts localhost by name when allowed", () => {
      expect(
        parseSemanticBaseUrl("http://localhost:8000/v1", { allowLoopbackHttp: true })?.host,
      ).toBe("localhost");
    });

    it("refuses loopback by default", () => {
      expect(parseSemanticBaseUrl("http://127.0.0.1:11434/v1")).toBeUndefined();
    });

    it("does not let the loopback allowance reach a non-loopback private address", () => {
      expect(
        parseSemanticBaseUrl("http://10.0.0.5/v1", { allowLoopbackHttp: true }),
      ).toBeUndefined();
      expect(
        parseSemanticBaseUrl("http://169.254.169.254/v1", { allowLoopbackHttp: true }),
      ).toBeUndefined();
    });
  });
});
