import { describe, expect, it } from "vitest";

import { isPrivateHost, parsePublicHttpsUrl } from "../src/public-destination.js";
import { parseSemanticBaseUrl } from "../src/semantic-endpoint.js";

const PRIVATE_HOSTS = [
  "localhost",
  "localhost.",
  "relay.localhost",
  "printer.local",
  "service.internal",
  "nas.home.arpa",
  "0.0.0.0",
  "10.0.0.5",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.10",
  "224.0.0.1",
  "[::1]",
  "[::ffff:127.0.0.1]",
];

const PUBLIC_HOSTS = [
  "api.openai.com",
  "cloud.example.com",
  "8.8.8.8",
  "172.32.0.1",
  "100.128.0.1",
];

describe("isPrivateHost", () => {
  it.each(PRIVATE_HOSTS)("refuses %s", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(PUBLIC_HOSTS)("allows %s", (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe("parsePublicHttpsUrl", () => {
  it("accepts a public HTTPS destination", () => {
    expect(parsePublicHttpsUrl("https://hooks.example.com/relay")?.hostname).toBe(
      "hooks.example.com",
    );
  });

  it.each([
    ["plain HTTP", "http://hooks.example.com/relay"],
    ["embedded credentials", "https://user:secret@hooks.example.com/relay"],
    ["a username alone", "https://user@hooks.example.com/relay"],
    ["an unparseable value", "not a url"],
    ["a private address", "https://10.0.0.5/relay"],
    ["the metadata address", "https://169.254.169.254/latest/meta-data"],
    ["a local name", "https://nas.home.arpa/relay"],
  ])("refuses %s", (_name, value) => {
    expect(parsePublicHttpsUrl(value)).toBeUndefined();
  });

  // WHATWG URL parsing rewrites these to dotted quads before the host is checked, so an encoded
  // loopback cannot slip past the numeric ranges.
  it.each(["https://2130706433/", "https://0x7f.0.0.1/", "https://0177.0.0.1/"])(
    "refuses %s, an encoded loopback address",
    (value) => {
      expect(parsePublicHttpsUrl(value)).toBeUndefined();
    },
  );

  it("checks the name as written, never its DNS answer", () => {
    // Pinned on purpose: a public name that later resolves to a private address passes. What that
    // leaves open is recorded in docs/integrations/webhook.md, not hidden behind this function.
    expect(parsePublicHttpsUrl("https://rebind.example.com/")).toBeDefined();
  });
});

describe("the semantic endpoint's strict path", () => {
  it.each([...PRIVATE_HOSTS, ...PUBLIC_HOSTS])(
    "refuses %s exactly when the shared rule does",
    (host) => {
      expect(parseSemanticBaseUrl(`https://${host}/v1`) === undefined).toBe(isPrivateHost(host));
    },
  );
});
