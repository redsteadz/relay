import assert from "node:assert/strict";
import test from "node:test";

import { buildHostedAuthConfig, configureHostedAuth } from "./configure-supabase-auth.mjs";

const hostedConfig = {
  environment: "hosted",
  projectRef: "abcdefghijklmnopqrst",
  siteUrl: "https://relay.example",
  webRedirectUrl: "https://relay.example/auth/callback",
};

test("builds the exact hosted Auth allowlist", () => {
  assert.deepEqual(buildHostedAuthConfig(hostedConfig).body, {
    disable_signup: true,
    site_url: "https://relay.example",
    uri_allow_list: "com.redsteadz.relay://auth/callback,https://relay.example/auth/callback",
  });
});

test("rejects split environment labels", () => {
  assert.throws(() => buildHostedAuthConfig({ ...hostedConfig, environment: "development" }));
  assert.throws(() => buildHostedAuthConfig({ ...hostedConfig, environment: "production" }));
});

test("rejects insecure, local, IP, wildcard, and mismatched URLs", () => {
  const invalidUrls = [
    "http://relay.example",
    "https://localhost",
    "https://127.0.0.1",
    "https://*.relay.example",
    "https://relay.example/{path}",
  ];
  for (const siteUrl of invalidUrls) {
    assert.throws(() => buildHostedAuthConfig({ ...hostedConfig, siteUrl }));
  }
  assert.throws(() =>
    buildHostedAuthConfig({
      ...hostedConfig,
      webRedirectUrl: "https://other.example/auth/callback",
    }),
  );
  assert.throws(() =>
    buildHostedAuthConfig({
      ...hostedConfig,
      webRedirectUrl: "https://relay.example/other",
    }),
  );
});

test("rejects preview and development hosted domains", () => {
  for (const hostname of ["relay-development.example", "relay.pages.dev", "relay.vercel.app"]) {
    assert.throws(() =>
      buildHostedAuthConfig({
        ...hostedConfig,
        siteUrl: `https://${hostname}`,
        webRedirectUrl: `https://${hostname}/auth/callback`,
      }),
    );
  }
});

test("patches the restricted Auth policy and verifies the response", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { options, url };
    return {
      json: async () => ({
        disable_signup: true,
        site_url: "https://relay.example",
        uri_allow_list: "com.redsteadz.relay://auth/callback,https://relay.example/auth/callback",
      }),
      ok: true,
      status: 200,
    };
  };

  await configureHostedAuth(hostedConfig, "synthetic-token", fetchImpl);

  assert.equal(
    request.url,
    "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth",
  );
  assert.equal(request.options.method, "PATCH");
  assert.deepEqual(JSON.parse(request.options.body), {
    disable_signup: true,
    site_url: "https://relay.example",
    uri_allow_list: "com.redsteadz.relay://auth/callback,https://relay.example/auth/callback",
  });
  assert.equal(request.options.headers.authorization, "Bearer synthetic-token");
});

test("rejects an inexact Auth response", async () => {
  const fetchImpl = async () => ({
    json: async () => ({
      disable_signup: true,
      site_url: "https://relay.example/unexpected",
      uri_allow_list: "com.redsteadz.relay://auth/callback,https://relay.example/auth/callback",
    }),
    ok: true,
    status: 200,
  });

  await assert.rejects(
    configureHostedAuth(hostedConfig, "synthetic-token", fetchImpl),
    /did not match requested policy/u,
  );
});

test("rejects an Auth response that leaves signup enabled", async () => {
  const fetchImpl = async () => ({
    json: async () => ({
      disable_signup: false,
      site_url: "https://relay.example",
      uri_allow_list: "com.redsteadz.relay://auth/callback,https://relay.example/auth/callback",
    }),
    ok: true,
    status: 200,
  });

  await assert.rejects(
    configureHostedAuth(hostedConfig, "synthetic-token", fetchImpl),
    /did not match requested policy/u,
  );
});
