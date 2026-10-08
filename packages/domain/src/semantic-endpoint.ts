/**
 * Validation for a semantic evaluation endpoint.
 *
 * Lives in the domain because two runtimes need the identical answer: `apps/api` validates a base
 * URL before storing it beside a tenant's key, and `apps/pipeline` validates it again before sending
 * anything. Two copies of an SSRF rule is one copy too many.
 *
 * Pure and runtime-neutral: it returns `undefined` for a rejected URL rather than throwing, so each
 * runtime can raise its own typed error without this module knowing about either.
 */

export type SemanticEndpointUrl = {
  /** Normalized origin and path with no trailing slash, ready to compose a route onto. */
  baseUrl: string;
  /** Lowercased hostname, recorded on disclosures so history says where data actually went. */
  host: string;
};

export type SemanticEndpointOptions = {
  /**
   * Permit plain HTTP to a loopback address.
   *
   * Only ever true in development, where it is how a locally hosted model under Ollama or vLLM is
   * reached and the traffic never leaves the machine. A deployed Worker could not reach a
   * developer's loopback anyway, so this is a development affordance rather than a policy hole.
   */
  allowLoopbackHttp?: boolean;
  /**
   * The caller is the reader's own device, on the network it is asking about.
   *
   * The refusal below exists because a tenant-supplied base URL is an SSRF primitive *for a
   * server*: it would turn semantic evaluation into a probe of whatever the runtime can reach. That
   * reasoning does not transfer to a phone. The device is on the network in question and is making a
   * request its owner configured, so there is no confused deputy to exploit and the only reachable
   * things are the reader's own. Refusing `192.168.1.10:11434` there would forbid exactly the
   * configuration a locally hosted model requires.
   *
   * So this permits plain HTTP to the ranges a self-hosted model actually lives on, and nothing
   * else: credentials, query strings and fragments stay refused on both paths, and addresses no
   * model is ever hosted on stay refused too. It widens a named set rather than removing a check.
   *
   * Only a device caller passes this. Every server-side caller keeps the strict policy, which is the
   * same function with a different argument rather than a second rule. See
   * [ADR-0019](../../../docs/decisions/0019-device-semantic-evaluation.md).
   */
  allowLocalNetwork?: boolean;
};

/**
 * Addresses a configured endpoint must never resolve to.
 *
 * A base URL is operator or tenant supplied, so without this it is an SSRF primitive: pointing it at
 * a link-local or private address would turn semantic evaluation into a probe of whatever the
 * runtime can reach. Numeric forms are rejected outright rather than resolved, and names that
 * conventionally denote a local network are rejected too.
 */
function isPrivateHost(hostname: string): boolean {
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

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

/**
 * Addresses a reader's own model server is plausibly reachable at from their own phone.
 *
 * Deliberately an allowlist of the ranges self-hosting actually uses, not the complement of
 * `isPrivateHost`. The documentation and benchmark ranges, `0.0.0.0/8` and multicast stay refused
 * because nothing is ever hosted there, so a URL naming one is a mistake or an attempt rather than a
 * configuration.
 *
 * `100.64/10` is included because that is where a Tailscale host appears, which is how a phone off
 * the home network reaches a machine on it. IPv6 literals other than loopback stay refused: the
 * useful ranges would be `fc00::/7` and `fe80::/10`, and parsing those correctly is not worth
 * guessing at while a hostname or an IPv4 literal covers every setup this is for.
 */
function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (isLoopback(host)) return true;
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }
  if (host.includes(":")) return false;

  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    !octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return false;
  }
  const [first = 0, second = 0] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/**
 * Validates and normalizes a semantic endpoint base URL.
 *
 * Requires HTTPS, no embedded credentials, and no query or fragment, and refuses private and
 * link-local addresses. A query string is rejected rather than preserved because several gateways
 * accept a key there, and a base URL that can carry a credential would smuggle one into every log
 * and disclosure record that names the endpoint.
 *
 * Returns `undefined` rather than throwing; the caller decides what a rejection means.
 */
export function parseSemanticBaseUrl(
  value: string,
  options: SemanticEndpointOptions = {},
): SemanticEndpointUrl | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  const localNetwork = options.allowLocalNetwork === true && isLocalNetworkHost(url.hostname);
  // A local model server almost never has a certificate, so permitting the address without
  // permitting plain HTTP to it would be permitting nothing.
  const plainHttpPermitted =
    (options.allowLoopbackHttp === true && isLoopback(url.hostname)) || localNetwork;
  const insecure = url.protocol === "http:" && plainHttpPermitted;
  if (
    (url.protocol !== "https:" && !insecure) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (isPrivateHost(url.hostname) && !insecure && !localNetwork)
  ) {
    return undefined;
  }

  return {
    baseUrl: url.toString().replace(/\/$/u, ""),
    host: url.hostname.toLowerCase().replace(/^\[|\]$/gu, ""),
  };
}
