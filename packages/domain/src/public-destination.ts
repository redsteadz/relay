/**
 * Whether a URL a tenant or operator supplied is safe for a server runtime to send a request to.
 *
 * One rule for every server-side destination: the semantic endpoint, Nextcloud, and webhook
 * receivers. Each of those used to carry its own copy, and the copies had already drifted (the
 * Nextcloud one missed `.home.arpa`). A caller that needs something stricter, such as the semantic
 * endpoint refusing a query string, adds that on top; nothing here can be relaxed by an argument.
 * The semantic endpoint's local-network allowance for a reader's own device lives in
 * `semantic-endpoint.ts`, deliberately out of reach of the other callers.
 *
 * This checks the URL as written. It never resolves a hostname, so a public name whose DNS later
 * points at a private address passes; see `docs/integrations/webhook.md` for what that leaves open.
 *
 * Pure and runtime-neutral: it returns `undefined` for a rejected URL rather than throwing, so each
 * runtime raises its own typed error.
 */

/**
 * Addresses a configured destination must never name.
 *
 * Without this, a destination URL is an SSRF primitive: pointing it at a link-local or private
 * address would turn the request into a probe of whatever the runtime can reach. Numeric forms are
 * rejected outright rather than resolved, and names that conventionally denote a local network are
 * rejected too.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }
  // Any IPv6 literal, which also covers ::1 and the IPv4-mapped forms that would otherwise slip
  // past the dotted-quad check below.
  if (host.includes(":")) return true;

  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    !octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return false;
  }
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0)
  );
}

/**
 * Parses a destination a server runtime may send to: HTTPS, no embedded credentials, and a host
 * that `isPrivateHost` does not refuse.
 *
 * Returns `undefined` rather than throwing; the caller decides what a rejection means.
 */
export function parsePublicHttpsUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    isPrivateHost(url.hostname)
  ) {
    return undefined;
  }
  return url;
}
