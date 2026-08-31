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

  const loopbackHttp =
    options.allowLoopbackHttp === true && isLoopback(url.hostname) && url.protocol === "http:";
  if (
    (url.protocol !== "https:" && !loopbackHttp) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (isPrivateHost(url.hostname) && !loopbackHttp)
  ) {
    return undefined;
  }

  return {
    baseUrl: url.toString().replace(/\/$/u, ""),
    host: url.hostname.toLowerCase().replace(/^\[|\]$/gu, ""),
  };
}
