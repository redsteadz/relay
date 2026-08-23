---
status: accepted
owner: integrations
last_verified: 2026-08-24
sources:
  - https://budget.otherworld.dev/docs/api.html
  - https://github.com/otherworld-dev/Budget/blob/master/budget/openapi.json
---

# Nextcloud Budget

Target is `otherworld-dev/Budget` REST API v1, not Cospend. Base path is
`/ocs/v2.php/apps/budget/api/v1`. Relay authenticates through Nextcloud Login Flow v2 or user-created
app password and sends `OCS-APIRequest: true` plus JSON acceptance headers.

Relay discovers capabilities, accounts, and categories before rule setup. Transaction creation uses
form data and preserves amount as exact decimal string. Type is `debit` or `credit`; amount remains
positive. Relay action UUID is sent as Budget `idempotency_key`, which Budget retains for retry-safe
transaction creation.

If transaction creation succeeds while receipt or split attachment fails, Relay must not recreate
transaction. It records partial result and retries only dedicated receipt/split operation.

Server URLs are user-controlled and require SSRF defenses before backend connection.
