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

/**
 * The device caller.
 *
 * The refusal of private addresses is an SSRF guard for a *server*: a tenant-supplied base URL would
 * turn evaluation into a probe of whatever the runtime can reach. A phone is on the network in
 * question and is making a request its owner configured, so the guard protects nothing there and
 * forbids exactly the configuration a self-hosted model needs.
 *
 * Every case below is therefore about one of two things: that the option widens a *named* set, and
 * that it widens nothing for anybody else. See ADR-0019.
 */
describe("allowLocalNetwork", () => {
  const device = { allowLocalNetwork: true } as const;

  it.each([
    ["http://192.168.1.10:11434/v1", "192.168.1.10"],
    ["http://10.0.0.5:8080/v1", "10.0.0.5"],
    ["http://172.16.4.2:11434/v1", "172.16.4.2"],
    ["http://127.0.0.1:11434/v1", "127.0.0.1"],
    // Where a Tailscale host appears, which is how a phone off the home network reaches one on it.
    ["http://100.101.102.103:11434/v1", "100.101.102.103"],
    ["http://desktop.local:11434/v1", "desktop.local"],
    ["http://ollama.home.arpa/v1", "ollama.home.arpa"],
  ])("accepts %s from a device", (value, host) => {
    expect(parseSemanticBaseUrl(value, device)?.host).toBe(host);
  });

  // The whole point: a server caller gets the strict policy from the same function. If this ever
  // passes, the SSRF guard has been removed rather than scoped.
  it.each([
    "http://192.168.1.10:11434/v1",
    "http://10.0.0.5:8080/v1",
    "http://desktop.local:11434/v1",
    "http://100.101.102.103:11434/v1",
  ])("still refuses %s without the option", (value) => {
    expect(parseSemanticBaseUrl(value)).toBeUndefined();
  });

  // Nothing is hosted on these, so a URL naming one is a mistake or an attempt. The option widens an
  // allowlist; it does not invert the check.
  it.each([
    "http://0.0.0.0:11434/v1",
    "http://239.255.0.1:11434/v1",
    "http://198.18.0.1:11434/v1",
    "http://203.0.113.1:11434/v1",
    "http://[fd00::1]:11434/v1",
  ])("refuses %s even from a device", (value) => {
    expect(parseSemanticBaseUrl(value, device)).toBeUndefined();
  });

  // A base URL that can carry a credential smuggles one into every log and disclosure that names the
  // endpoint. That reasoning is unaffected by who is calling.
  it.each([
    "http://user:pass@192.168.1.10:11434/v1",
    "http://192.168.1.10:11434/v1?api-key=secret",
    "http://192.168.1.10:11434/v1#fragment",
  ])("refuses %s from a device too", (value) => {
    expect(parseSemanticBaseUrl(value, device)).toBeUndefined();
  });

  // A public host is still held to HTTPS from a device: the local-network exemption is about
  // addresses that cannot have a certificate, not about dropping transport security generally.
  it("still requires https for a public host from a device", () => {
    expect(parseSemanticBaseUrl("http://api.openai.com/v1", device)).toBeUndefined();
    expect(parseSemanticBaseUrl("https://api.openai.com/v1", device)?.host).toBe("api.openai.com");
  });
});
