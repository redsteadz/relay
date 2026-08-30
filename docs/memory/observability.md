---
status: accepted
owner: maintainers
last_verified: 2026-08-30
---

# Error Handling And Observability

This document is the canonical implementation guide for application errors and logs. The privacy
limits remain authoritative in [Privacy and data lifecycle](../security/privacy.md). Agents must use
the existing observability package and runtime adapters instead of adding another logger, error
hierarchy, DEBUG convention, or ad hoc serializer.

## Implemented Surfaces

| Surface                                                                           | Required entry point                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Shared error model, normalization, redaction, serialization, logging, request IDs | `@relay/observability` in `packages/observability/src/index.ts` |
| Next.js API routes and API integrations                                           | `apps/api/lib/observability.ts`                                 |
| Expo/mobile integrations and background work                                      | `apps/mobile/lib/observability.ts`                              |
| Queue, Workflow, Durable Object, database, and provider failures                  | `apps/pipeline/src/observability.ts`                            |

Do not import a runtime adapter across an architecture boundary. Pure domain code must not log.
Cross-runtime wire contracts must not contain stack traces, causes, or arbitrary upstream messages.

## Required Error Flow

1. Catch errors as `unknown` and narrow them safely.
2. At an integration boundary, preserve the original value as `cause` and normalize it to
   `AppError`. Add a stable code, integration, operation, retryability, HTTP status when known, and
   allowlisted metadata only.
3. Let intermediate layers add context by wrapping with `cause`; they normally do not log.
4. At the boundary where the failure becomes an HTTP response, failed background job, or terminal UI
   integration result, emit one structured log with the runtime adapter.
5. Return or display only the centralized deterministic `userMessage` or an established safe
   contract message. Never return the internal `message`, stack, cause, metadata, or upstream body.

Logging every rethrow creates duplicate incidents. Log earlier only when that layer performs a retry,
recovery, or fallback whose outcome would otherwise be invisible. Use a distinct event for that
attempt or recovery rather than repeating the terminal event.

When constructing an application error directly, preserve its cause:

```ts
throw new AppError("Relay integration operation failed", {
  category: "upstream-service",
  cause: error,
  code: "RELAY_INTEGRATION_REQUEST_FAILED",
  integration: "relay",
  operation: "updatePrivacySettings",
  retryable: true,
});
```

Never use `catch {}`, `.catch(() => undefined)`, or replacement errors without `cause`. Do not assume
an unknown caught value has `message`, `stack`, `status`, or `code` fields.

## Error Categories And User Messages

`AppError` supports `cancelled`, `configuration`, `database`, `forbidden`, `internal`,
`malformed-response`, `network`, `not-found`, `rate-limit`, `timeout`, `unauthorized`, `unavailable`,
`upstream-service`, and `validation`. Use `normalizeError` for unknown failures,
`httpResponseError` for non-success HTTP responses, and `userMessageForCategory` for a safe generic
mapping. Integration-specific safe messages may override `userMessage`, but raw SDK/provider text is
never a user message.

Retry only when the normalized error is retryable and the operation is safe to repeat. Network,
timeout, rate-limit, selected unavailable/5xx, and upstream-service errors default to retryable.
Authentication, authorization, validation, configuration, cancellation, and malformed requests are
not blindly retried. A retryable classification does not override action idempotency requirements.

## Runtime Usage

### API

- Resolve correlation once with `apiRequestId(request)` and propagate `x-relay-request-id` on
  downstream calls and final responses.
- Use `databaseError` to wrap Supabase failures without logging them at every repository call.
- Use `logApiError` or `loggedErrorResponse` when the route/integration failure becomes terminal.
- Keep response shapes stable and deterministic. Do not serialize `AppError` into an HTTP response.

### Mobile

- Generate and propagate request IDs with `mobileRequestId` for API operations.
- Use `logMobileError` at a terminal integration boundary.
- Use `runInBackground` for intentional fire-and-forget promises so rejection is observable.
- Use `reportUnexpectedUiError` only for unexpected UI failures. It intentionally avoids re-logging
  an `AppError` already recorded at its integration boundary.

### Pipeline

- Use `logPipelineError` when a Queue, Workflow, Durable Object, provider, or database operation has
  ultimately failed.
- Include the propagated request ID, fixed operation name, start time, and integration when known.
- A retry attempt may have its own fixed warning/error event, but the same exception must not produce
  identical stack logs at provider, service, queue, and HTTP layers.
- Intentional parse rejection of decrypted source content must remain a fixed validation outcome; do
  not pass parser text or decrypted values to observability.

## Structured Log Contract

Events and context keys are code-owned, fixed vocabulary. Prefer fields such as:

```text
level, event, namespace, requestId, durationMs, retryAttempt, endpointName,
error.code, error.category, error.integration, error.operation,
error.statusCode, error.retryable
```

Event names use stable dot-separated identifiers such as `privacy.overview_failed`. Metadata must
be an explicit allowlist of bounded booleans, counts, enum-like values, status codes, and timing. Do
not pass whole request objects, headers, SDK errors, user records, provider responses, URLs, or bodies
as context. The central redactor is defense in depth, not permission to submit sensitive data.

Application logs must never contain tenant, device, connection, envelope, source, mailbox, message,
prompt, ciphertext, credential, authorization, token, cookie, session, password, private key, arbitrary
URL, or request/response body values. Sensitive nested keys and common bearer/key patterns are
recursively redacted; strings and collections are bounded. Add redaction tests before introducing a
new credential shape or sensitive key alias.

## DEBUG And Correlation

DEBUG is namespaced and unset by default:

```dotenv
DEBUG=relay:api,relay:pipeline
EXPO_PUBLIC_DEBUG=relay:mobile
```

The production/default log contains concise normalized error fields. An enabled namespace adds
sanitized stack frames and a bounded cause chain containing only cause type, fixed code/category, and
status. DEBUG never permits raw upstream messages, payloads, identifiers, secrets, or full headers.
Do not add a second boolean debug switch or commit DEBUG enabled as a default.

Only accept or generate bounded `x-relay-request-id` values through the shared `requestId` helper.
Propagate that ID through Mobile, API, and Pipeline where the call path supports it. Never use user or
tenant identifiers as correlation IDs.

## Agent Change Checklist

When adding or changing a failure path:

- preserve the original error as `cause`;
- choose a stable category, code, integration, operation, event, and retry classification;
- keep the user response deterministic and free of internal details;
- log once at the terminal boundary and make every fire-and-forget rejection observable;
- pass only allowlisted metadata and verify no source content, identifier, URL, body, or secret enters
  the log call;
- propagate the request ID where supported;
- test known classification, unknown fallback, cause preservation, redaction, production versus DEBUG
  serialization, and async rejection handling as applicable;
- run formatting, lint, typecheck, unit tests, relevant integration tests, and affected builds.

Malformed client JSON rejected before trusted context exists and intentionally fixed invalid outcomes
for decrypted source data are the only normal exceptions to error logging. They still require an
explicit safe response/outcome; never add a catch merely to make an exception disappear.
