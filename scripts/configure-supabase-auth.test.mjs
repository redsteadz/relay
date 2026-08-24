import assert from "node:assert/strict";
import test from "node:test";

import { buildHostedAuthConfig, configureHostedAuth } from "./configure-supabase-auth.mjs";

const developmentConfig = {
  environment: "development",
  projectRef: "abcdefghijklmnopqrst",
  siteUrl: "https://dev.relay.example",
  webRedirectUrl: "https://dev.relay.example/auth/callback",
};

test("builds an exact development Auth allowlist", () => {
  assert.deepEqual(buildHostedAuthConfig(developmentConfig).body, {
    site_url: "https://dev.relay.example",
    uri_allow_list: "com.redsteadz.relay://auth/callback,https://dev.relay.example/auth/callback",
  });
});

test("accepts a stable production domain", () => {
  assert.doesNotThrow(() =>
    buildHostedAuthConfig({
      ...developmentConfig,
      environment: "production",
      siteUrl: "https://relay.example",
      webRedirectUrl: "https://relay.example/auth/callback",
    }),
  );
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
    assert.throws(() => buildHostedAuthConfig({ ...developmentConfig, siteUrl }));
  }
  assert.throws(() =>
    buildHostedAuthConfig({
      ...developmentConfig,
      webRedirectUrl: "https://other.example/auth/callback",
    }),
  );
  assert.throws(() =>
    buildHostedAuthConfig({
      ...developmentConfig,
      webRedirectUrl: "https://dev.relay.example/other",
    }),
  );
});

test("rejects preview and development production hosts", () => {
  for (const hostname of ["relay-development.example", "relay.pages.dev", "relay.vercel.app"]) {
    assert.throws(() =>
      buildHostedAuthConfig({
        ...developmentConfig,
        environment: "production",
        siteUrl: `https://${hostname}`,
        webRedirectUrl: `https://${hostname}/auth/callback`,
      }),
    );
  }
});

test("patches only Auth URLs and verifies the response", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { options, url };
    return {
      json: async () => ({
        site_url: "https://dev.relay.example",
        uri_allow_list:
          "com.redsteadz.relay://auth/callback,https://dev.relay.example/auth/callback",
      }),
      ok: true,
      status: 200,
    };
  };

  await configureHostedAuth(developmentConfig, "synthetic-token", fetchImpl);

  assert.equal(
    request.url,
    "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth",
  );
  assert.equal(request.options.method, "PATCH");
  assert.deepEqual(JSON.parse(request.options.body), {
    site_url: "https://dev.relay.example",
    uri_allow_list: "com.redsteadz.relay://auth/callback,https://dev.relay.example/auth/callback",
  });
  assert.equal(request.options.headers.authorization, "Bearer synthetic-token");
});

test("rejects an inexact Auth response", async () => {
  const fetchImpl = async () => ({
    json: async () => ({
      site_url: "https://dev.relay.example/unexpected",
      uri_allow_list: "com.redsteadz.relay://auth/callback,https://dev.relay.example/auth/callback",
    }),
    ok: true,
    status: 200,
  });

  await assert.rejects(
    configureHostedAuth(developmentConfig, "synthetic-token", fetchImpl),
    /did not match exact requested URLs/u,
  );
});
