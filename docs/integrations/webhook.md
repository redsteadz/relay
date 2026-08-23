---
status: accepted
owner: integrations
last_verified: 2026-08-24
---

# Signed Webhooks

Relay sends a versioned JSON action envelope with action UUID, event type, structured fields,
attempt timestamp, and delivery attempt. It signs raw request bytes with HMAC-SHA256 and a
per-connection secret. Headers carry signature version, timestamp, and action ID.

Receivers must reject stale timestamps and deduplicate action ID. Relay retries transient failures
and treats most client errors as permanent. Redirects are disabled by default. HTTPS, DNS/IP
validation, private-network rejection, response-size limits, and re-resolution protect against SSRF.

Webhook templates may select allowlisted event fields but cannot inject arbitrary headers, URLs, or
code from source content.

Related: [action model](../architecture/action-model.md), [threat model](../security/threat-model.md).
