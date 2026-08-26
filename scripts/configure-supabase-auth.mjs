import { isIP } from "node:net";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

const MOBILE_REDIRECT_URL = "com.redsteadz.relay://auth/callback";
const PROJECT_REF_PATTERN = /^[a-z]{20}$/u;
const FORBIDDEN_PRODUCTION_LABEL = /(^|[.-])(dev|development|preview|staging|test)([.-]|$)/u;
const EPHEMERAL_HOST_SUFFIXES = [".netlify.app", ".pages.dev", ".vercel.app", ".workers.dev"];
const GLOB_CHARACTERS = ["*", "?", "[", "]", "{", "}", "\\"];

function parseHostedUrl(value, name) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${name} must be a nonempty URL without surrounding whitespace`);
  }
  if (GLOB_CHARACTERS.some((character) => value.includes(character))) {
    throw new Error(`${name} must not contain wildcard syntax`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${name} must not contain credentials`);
  }
  if (parsed.port !== "") throw new Error(`${name} must use the default HTTPS port`);
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`${name} must not contain a query or fragment`);
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname) !== 0) {
    throw new Error(`${name} must use an approved hosted domain`);
  }

  return parsed;
}

export function buildHostedAuthConfig({ environment, projectRef, siteUrl, webRedirectUrl }) {
  if (environment !== "development" && environment !== "production") {
    throw new Error("RELAY_SUPABASE_ENVIRONMENT must be development or production");
  }
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error("RELAY_SUPABASE_PROJECT_REF must be a 20-letter project ref");
  }

  const site = parseHostedUrl(siteUrl, "RELAY_AUTH_SITE_URL");
  const webRedirect = parseHostedUrl(webRedirectUrl, "RELAY_AUTH_WEB_REDIRECT_URL");
  if (site.pathname !== "/")
    throw new Error("RELAY_AUTH_SITE_URL must be an origin without a path");
  if (webRedirect.pathname !== "/auth/callback") {
    throw new Error("RELAY_AUTH_WEB_REDIRECT_URL must use the exact /auth/callback path");
  }
  if (site.origin !== webRedirect.origin) {
    throw new Error("Supabase Auth site and web callback must use the same origin");
  }

  const hostname = site.hostname.toLowerCase();
  if (
    environment === "production" &&
    (FORBIDDEN_PRODUCTION_LABEL.test(hostname) ||
      EPHEMERAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)))
  ) {
    throw new Error("Production Auth must use an approved stable production domain");
  }

  return {
    body: {
      disable_signup: true,
      site_url: site.origin,
      uri_allow_list: `${MOBILE_REDIRECT_URL},${webRedirect.href}`,
    },
    environment,
    projectRef,
  };
}

export async function configureHostedAuth(input, accessToken, fetchImpl = globalThis.fetch) {
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    throw new Error("SUPABASE_ACCESS_TOKEN is required");
  }

  const config = buildHostedAuthConfig(input);
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${config.projectRef}/config/auth`,
    {
      body: JSON.stringify(config.body),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "PATCH",
    },
  );
  if (!response.ok) throw new Error(`Supabase Auth update failed with HTTP ${response.status}`);

  const result = await response.json();
  const actualRedirects = new Set(
    typeof result.uri_allow_list === "string"
      ? result.uri_allow_list.split(",").map((value) => value.trim())
      : [],
  );
  const expectedRedirects = new Set(config.body.uri_allow_list.split(","));
  let actualSite;
  try {
    actualSite = new URL(result.site_url);
  } catch {
    throw new Error("Supabase Auth update response did not match requested policy");
  }
  if (
    actualSite.origin !== config.body.site_url ||
    actualSite.pathname !== "/" ||
    actualSite.search !== "" ||
    actualSite.hash !== "" ||
    result.disable_signup !== true ||
    actualRedirects.size !== expectedRedirects.size ||
    [...expectedRedirects].some((value) => !actualRedirects.has(value))
  ) {
    throw new Error("Supabase Auth update response did not match requested policy");
  }

  return config;
}

async function main() {
  const config = await configureHostedAuth(
    {
      environment: process.env.RELAY_SUPABASE_ENVIRONMENT,
      projectRef: process.env.RELAY_SUPABASE_PROJECT_REF,
      siteUrl: process.env.RELAY_AUTH_SITE_URL,
      webRedirectUrl: process.env.RELAY_AUTH_WEB_REDIRECT_URL,
    },
    process.env.SUPABASE_ACCESS_TOKEN,
  );
  globalThis.console.log(`Updated restricted Supabase Auth policy for ${config.environment}.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    globalThis.console.error(
      error instanceof Error ? error.message : "Supabase Auth update failed",
    );
    process.exitCode = 1;
  });
}
