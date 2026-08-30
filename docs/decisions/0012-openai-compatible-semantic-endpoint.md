---
status: accepted
date: 2026-08-30
owners: maintainers
refines: 0003-deterministic-before-ai.md
---

# ADR-0012: OpenAI-Compatible Semantic Endpoint

## Context

[ADR-0003](0003-deterministic-before-ai.md) names OpenAI specifically: undecidable semantic clauses
are resolved "through the user OpenAI key". That was a reasonable shorthand when OpenAI was the only
BYOK connector, but it fixes a vendor into an architectural decision where what actually matters is
the boundary around the call.

Users have reasons to send that traffic elsewhere. A gateway may be cheaper or already procured, a
different model may judge their mail better, and a locally hosted model means the content never
leaves their machine at all -- which is strictly better for the privacy goals in
[privacy](../security/privacy.md) than any hosted option.

Meanwhile the decision that carries the weight in ADR-0003 is not "OpenAI". It is: deterministic
predicates first, allowlisted fields only, redaction before disclosure, strict output shape,
confidence threshold, disclosure audit, and no capacity for the model to select an effect. None of
that depends on who serves the request.

## Decision

Semantic clauses are evaluated against a configurable **OpenAI-compatible** endpoint: chat
completions with a bearer key. The base URL, model, and how much of the answer shape the endpoint is
asked to enforce are configuration, defaulting to OpenAI so an existing deployment is unchanged.

Relay does not add native support for other wire formats. One protocol keeps one request builder,
one response parser, and one error taxonomy, which is what makes the guarantees above auditable.
Anthropic, Google, and local models are reachable through gateways or servers that already speak this
protocol; adding their native APIs remains deferred, as ADR-0003 said.

Four constraints make this safe:

- **The endpoint is validated, not trusted.** HTTPS only, no embedded credentials, no query or
  fragment, and private, loopback, and link-local addresses refused. Plain HTTP to loopback is
  allowed only in development, matching the existing exception for a local Supabase. Without this a
  configurable URL would be an SSRF primitive. Validation reads the hostname and deliberately does
  not resolve it, so a public name pointing at a private address would still pass; the Pipeline
  Worker therefore also carries the `global_fetch_strictly_public` compatibility flag, refusing that
  request at the runtime. The local end-to-end harness keeps its own Worker configuration, so
  loopback development traffic is unaffected.
- **The endpoint can travel with the credential.** A key issued by a gateway is only valid at that
  gateway, so a tenant override read from the connection's metadata takes precedence over the
  operator default. An override that fails validation is an error, never a silent fallback to
  somewhere the tenant did not choose.
- **Relay validates the answer regardless.** Provider-side structured output is an optimization, not
  the guarantee. `semanticEvaluationSchema` is `.strict()` and gates every answer, so an endpoint
  that enforces nothing cannot widen what Relay accepts.
- **The disclosure record names the host.** "OpenAI received this" stops being true by construction,
  so each disclosure stores where the request actually went, and the database requires that host to
  be present exactly when something was sent.

## Consequences

Users can reach effectively any model, including a local one, without Relay learning another API.
The credential column stays `provider = 'openai'`, which now denotes the wire protocol and key type
rather than the vendor; that mismatch is a naming cost accepted over a migration.

An operator who repoints the base URL would invalidate every tenant key stored for the old endpoint,
since keys are not portable between providers. The per-tenant endpoint exists so this is a choice
rather than a forced migration: a tenant names their endpoint when submitting or rotating a key, and
the key is validated against that endpoint rather than against OpenAI. Rotating without naming one
keeps what is stored, so a replacement key is never silently repointed.

`provider = 'openai'` on the credential row now denotes the wire protocol and key type rather than
the vendor. That mismatch is a naming cost accepted over a migration.

Validation depends on `GET /models`, an OpenAI convention that most compatible servers implement but
none are obliged to. An endpoint without it yields a stored-but-unvalidated credential rather than a
refusal or a false claim of verification.

A weaker endpoint costs a round trip per malformed answer instead of having it refused at the
provider, and a model that cannot follow the instruction block will produce `undecided` more often.
Both are visible in the disclosure history rather than silent.

A locally hosted model is reachable only where the runtime can reach it. A deployed Cloudflare Worker
cannot see a developer's loopback, so plain HTTP to loopback is a development affordance; reaching a
local model from a deployed Worker means exposing it on a public HTTPS hostname.

Related: [filter model](../architecture/filter-model.md), [privacy](../security/privacy.md),
[OpenAI integration](../integrations/openai.md).
