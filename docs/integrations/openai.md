---
status: accepted
owner: integrations
last_verified: 2026-08-30
sources:
  - https://platform.openai.com/docs/api-reference/models/list
  - https://platform.openai.com/docs/api-reference/chat/create
  - https://platform.openai.com/docs/guides/structured-outputs
  - https://platform.openai.com/docs/guides/error-codes/api-errors
---

# OpenAI (BYOK)

Each user supplies their own key; Relay never provisions or shares one. The key is validated against
`GET {baseUrl}/models` on **the endpoint it is for** — status only, the response body is discarded and
never logged or stored — then envelope-encrypted with `@relay/crypto` and persisted in the shared
`connections` table alongside every other connector credential.

`provider = 'openai'` denotes the wire protocol and credential type, not the vendor: a DeepSeek,
OpenRouter, Together, Gemini-compatibility, or local key all live in that row, distinguished by the
endpoint stored beside them.

`apps/api` owns the lifecycle at `/api/connectors/openai`:

- `POST` validates and stores a new key. Rejects (`409`) if one is already configured; use `PATCH`
  to rotate instead.
- `PATCH` validates a replacement key and re-encrypts in place, keeping the same connection id and
  therefore the same AAD-bound encryption context. `404` if nothing is configured yet.
- `DELETE` deletes the stored credential outright (matching the Gmail connector's disconnect
  behavior) and disables any enabled filter rule whose plan has a `semantic` clause, since those
  rules can no longer be evaluated without a live key.
- `GET` returns only `{ provider, configured, lastValidatedAt? }`. It never reads or returns the
  ciphertext, wrapped key, or nonce columns, so mobile only ever sees configuration metadata.

Validation always happens server-side against the live key at submission/rotation time; Relay does
not currently run a periodic background re-validation of stored keys (tracked as future work, see
ADR-0003).

## Semantic Clause Evaluation

`apps/pipeline` is the only runtime that calls the model, matching the boundary that keeps provider
calls out of `apps/api`. It selects the tenant's single active `openai` connection with the service
role, decrypts the key in memory under the connection's own AAD context, and discards it with the
request. More than one active row for a tenant is ambiguous consent, so evaluation fails closed
rather than choosing one.

Requests go to `POST {baseUrl}/chat/completions` with `temperature` 0, a 200-token completion cap, a
15-second deadline, a 32 KB bounded response read, and no tools. The key travels only as a bearer
header. Responses use structured outputs with `strict` set, so the model can return exactly
`decision`, `confidence`, and `rationale`.

### Choosing an endpoint and model

The endpoint is OpenAI-compatible rather than OpenAI-specific, under
[ADR-0011](../decisions/0011-openai-compatible-semantic-endpoint.md). Operator defaults come from the
Pipeline environment, and all three are optional -- absent means OpenAI with `gpt-4.1-mini`, so an
existing deployment is unchanged:

| Variable                         | Default                     | Notes                                                             |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| `RELAY_SEMANTIC_BASE_URL`        | `https://api.openai.com/v1` | Validated: HTTPS, public host, no credentials, query, or fragment |
| `RELAY_SEMANTIC_MODEL`           | `gpt-4.1-mini`              | Bare or namespaced (`anthropic/claude-sonnet-4`)                  |
| `RELAY_SEMANTIC_RESPONSE_FORMAT` | `json-schema`               | `json-schema`, `json-object`, or `none`                           |

A tenant sets their own endpoint when they submit or rotate a key, and it takes precedence over the
operator default — a key issued by a gateway is only valid at that gateway, so the endpoint travels
with the credential:

```http
POST /api/connectors/openai
{
  "apiKey": "sk-...",
  "endpoint": {
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "responseFormat": "json-object"
  }
}
```

`endpoint` is optional and every field within it is optional. Rotating without naming one keeps the
endpoint already stored, so a replacement key is not silently pointed back at OpenAI. `GET` returns
the stored endpoint and a `validated` flag, never the key.

An endpoint that fails validation is a deterministic `400 openai_endpoint_invalid`, refused before
any network call or write. If the endpoint has no `/models` route the key is stored with
`validated: false` rather than being refused or claimed as verified.

### Known-working endpoints

| Provider                      | `baseUrl`                                                 | Example model                             |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| OpenAI                        | `https://api.openai.com/v1`                               | `gpt-4.1-mini`                            |
| DeepSeek                      | `https://api.deepseek.com/v1`                             | `deepseek-chat`                           |
| Gemini (OpenAI compatibility) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`                        |
| OpenRouter                    | `https://openrouter.ai/api/v1`                            | `anthropic/claude-sonnet-4`               |
| Together                      | `https://api.together.xyz/v1`                             | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Groq                          | `https://api.groq.com/openai/v1`                          | `llama-3.3-70b-versatile`                 |
| Ollama (local, development)   | `http://127.0.0.1:11434/v1`                               | `llama3.3`                                |

Base URLs and model names come from each provider's own documentation and drift; confirm against the
current docs rather than treating this table as authoritative. Not every endpoint implements strict
`json_schema` structured output — start on `json-object` where unsure, since it only changes what the
provider enforces.

`json-object` and `none` reduce only what the _endpoint_ is asked to enforce. Relay parses every
answer through the same `.strict()` contract schema, so a weaker endpoint cannot widen what is
accepted -- it just costs a round trip when the model answers badly.

Plain HTTP is refused except to a loopback address in development, which is how a locally hosted
model under Ollama or vLLM is reached (`http://127.0.0.1:11434/v1`). In that configuration content
never leaves the machine, and the disclosure history records `127.0.0.1` as the host.

Provider conditions map to a fixed reason and always resolve the filter to `undecided`:
`credential-revoked` for 401 and 403, `quota-exhausted` for a 429 whose `error.code` is
`insufficient_quota`, `rate-limited` for any other 429, `timed-out`, `response-too-large`,
`invalid-response`, and `unavailable`. Only that reason string crosses the boundary; no provider
message text, body, or header is retained, logged, or surfaced.

The full minimization, redaction, delimiting, and disclosure-record rules live with the
[filter model](../architecture/filter-model.md); this page covers only the provider mechanics.

### Local models

A local model only works where the runtime can reach it. `apps/pipeline` is a Cloudflare Worker, so a
deployed one cannot reach a developer's loopback — `127.0.0.1` there would be Cloudflare's own
machine. Loopback is therefore accepted only when `RELAY_ENVIRONMENT` is `development`, which matches
both the local-Supabase exception and what is physically reachable.

To use a local model from a deployed Worker, expose it on a public HTTPS hostname (a tunnel is the
usual way). It is then an ordinary endpoint and needs no exception.

### Known follow-up

The mobile settings UI has no field for the endpoint yet; the connector API accepts it, so this is
presentation work belonging with #80. Until then a non-default endpoint is set by calling the
connector endpoint directly.

Relay does not deduplicate evaluations across Queue redelivery. A redelivered item with the same
semantic clause is evaluated again, which means a second request to OpenAI and a second disclosure
row. Recording both is deliberate -- the history must not undercount what was sent -- but suppressing
the repeat evaluation belongs to the processing path that calls the evaluator and is not yet built.

## Known follow-up

The shared `connections` table's row-level security still grants an authenticated user direct
`select` on their own full row (ciphertext, wrapped key, and nonce columns included) if a client
queries Supabase directly instead of going through `apps/api`. No current mobile code path does
this for `connections`, and this predates the OpenAI connector (it also covers Gmail), so narrowing
that policy is left as separate, connector-agnostic hardening work rather than folded into this
change.

Related: [privacy and data lifecycle](../security/privacy.md),
[ADR-0003: deterministic filters before BYOK AI](../decisions/0003-deterministic-before-ai.md).
