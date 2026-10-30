---
status: accepted
owner: integrations
last_verified: 2026-10-30
sources:
  - https://developers.cloudflare.com/workers/runtime-apis/fetch/
  - https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
  - https://developers.cloudflare.com/workers/configuration/compatibility-flags/
---

# Signed Webhooks

Relay delivers an approved action to a receiver the tenant configured, as one signed HTTPS `POST`.
The receiver gets only the event fields the action rule selected, can prove the request came from
Relay, and can tell a retry from a new action.

## The Request

The body is UTF-8 JSON, and these exact bytes are what is signed:

```json
{
  "version": 1,
  "actionId": "6f98ad81-f071-418b-a426-8c8c9f627161",
  "eventType": "task",
  "attempt": 1,
  "fields": { "title": "Pay electricity bill", "dueAt": "2026-11-02T09:00:00Z" }
}
```

| Header            | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| `relay-action-id` | The action run's ID. Identical on every attempt of the same action          |
| `relay-timestamp` | Unix seconds when this attempt was signed                                   |
| `relay-signature` | `v1=<hex>`, or `v1=<hex>,v1=<hex>` while a rotated secret is still accepted |
| `content-type`    | `application/json`                                                          |

`actionId` is the ledger's derived run ID ([action model](../architecture/action-model.md#identity)),
so it is stable before the row exists and across every retry. `attempt` counts from 1.

### Fields

An action rule chooses which event fields to send from a fixed allowlist: `kind`, `title`,
`summary`, `startsAt`, `endsAt`, `dueAt`, `confidence` and `requiresReview`. A field that is not on
the list cannot be selected, and an empty selection is refused. Nothing from the source item
(sender, subject, body, application, attributes) is on the list, and a template cannot set the URL,
the method or any header. Data leaving Relay is chosen from a list Relay owns, not filtered out of
one the rule supplies.

## Verifying A Request

`v1` is HMAC-SHA256 over `<relay-timestamp>.<raw body bytes>` with the connection's secret,
lowercase hex. A receiver should:

1. Recompute `v1` with each secret it currently holds and accept if any entry in `relay-signature`
   matches, comparing in constant time.
2. Reject a `relay-timestamp` more than five minutes from its own clock.
3. Treat `relay-action-id` as an idempotency key: a second delivery of an ID it already processed is
   a retry, answered with success and not acted on twice.
4. Answer with a `2xx` once the request is accepted, before any slow work.

## Secrets And Rotation

Relay generates each connection's secret (32 random bytes) and shows it once. The secret and the
destination URL are encrypted together into the connection's credential under
[ADR-0005](../decisions/0005-versioned-wrapping-keys.md), the same envelope every other provider
uses. The URL is encrypted rather than stored in plain metadata because receivers commonly put a
bearer token in the path or query, which makes the URL a credential. Plain metadata holds only the
host, for display, and the signature version.

Rotating generates a new secret and signs with it immediately. For 24 hours afterwards Relay also
signs with the previous secret, so `relay-signature` carries both and a receiver can switch at any
point in that window. The expiry is kept in plain metadata so the maintenance pass can find expired
secrets without decrypting every webhook credential, and it then rewrites the credential without the
old one. Only two secrets exist at once: rotating again inside the window drops the oldest.

## Sending

The URL must pass `parsePublicHttpsUrl` (`packages/domain`) when it is saved and again before every
attempt: HTTPS, no embedded credentials, no private, loopback, link-local or local-network host.
Redirects are refused (`redirect: "manual"`), each attempt times out after ten seconds, and at most
64 KiB of the response is read and then discarded. Relay records the status code and never the
response body.

| Outcome                                      | Retried | Error code                       |
| -------------------------------------------- | ------- | -------------------------------- |
| `2xx`                                        | n/a     | succeeded                        |
| Network failure or timeout                   | Yes     | `webhook-unreachable`            |
| `408`, `429` or `5xx`                        | Yes     | `webhook-retryable-status`       |
| `3xx`                                        | No      | `webhook-redirect-refused`       |
| Any other `4xx`                              | No      | `webhook-rejected`               |
| URL fails the destination check at send time | No      | `webhook-destination-refused`    |
| Credential missing or cannot be decrypted    | No      | `webhook-credential-unavailable` |

A destination that passed when it was saved and fails later is permanent rather than retried: the
rule should stop and say so, not keep knocking on an address it may now resolve somewhere it
shouldn't. Every retry carries the same `relay-action-id`, so a receiver that saw an earlier attempt
succeed deduplicates. This page classifies outcomes; scheduling retries belongs to action dispatch.

## What This Does Not Stop

**DNS rebinding remains an open risk.** The destination check reads the hostname as written and never
resolves it, so a public name that later points at a private address passes every time. Relay cannot
close that gap from its own code: a Worker's `fetch()` resolves the name itself and does not expose
the address it connected to.

Cloudflare documents no private-address block for `fetch()`. The Workers
[fetch API reference](https://developers.cloudflare.com/workers/runtime-apis/fetch/) does not mention
private, internal or localhost addresses. The only documented block is for raw TCP sockets, where the
[TCP sockets troubleshooting entry](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
says: "Examples of a disallowed address include Cloudflare IPs, `localhost`, and private network
IPs." That covers `connect()`, not `fetch()`, and does not say whether it checks a resolved address.

Production Workers enable
[`global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/),
which makes `fetch()` "strictly route requests as if they were made on the public Internet", so a
destination in Relay's own zone cannot reach its origin around Cloudflare's security settings. That
flag says nothing about private address ranges. The Workers have no Tunnel or private-network
bindings, so Relay itself exposes nothing a rebound name could reach. What Cloudflare's own egress
can reach is outside what Relay can verify.

Related: [action model](../architecture/action-model.md), [threat model](../security/threat-model.md).
