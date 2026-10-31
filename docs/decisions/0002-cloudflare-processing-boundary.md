---
status: accepted
date: 2026-08-24
owners: maintainers
---

# ADR-0002: Cloudflare Processing Boundary

## Context

Ingestion needs low-latency acknowledgement while classification and provider calls need durable
retries, ordering, and approval waits.

## Decision

Deploy Next.js API through Cloudflare OpenNext as authentication/callback boundary. Forward canonical
work to a separate Worker. Use Queues for buffering, per-tenant Durable Objects for serialization,
Workflows for approval/provider operations, and Supabase for durable records.

## Consequences

API routes stay short and do not call providers. At-least-once delivery requires idempotency at each
boundary. Google Cloud Pub/Sub remains required for Gmail despite Cloudflare queue usage.

This boundary covers the work Relay's server does. It does not make a server necessary for the device
to work. Classification ([ADR-0014](0014-device-local-classification.md)), the derived store
([ADR-0015](0015-device-local-derived-store.md)), notification quieting
([ADR-0017](0017-notification-dismissal-after-posting.md)) and semantic evaluation against a model the
reader runs ([ADR-0019](0019-device-semantic-evaluation.md), the default) all happen on the device,
outside this boundary. The device holds the key to its own model endpoint. It never holds a Relay service or
provider-action credential, and never runs a provider action such as a Google Tasks, Nextcloud Budget
or webhook delivery.

The server side itself also runs on one machine: local Supabase, `next dev`, and
`wrangler dev --local` for the Worker ([Cloudflare operations](../operations/cloudflare.md)). Today
the app needs that backend, hosted or local, to sign in, to save a rule (`/api/filters/compile` hands
compilation to the pipeline) and to record a quiet-rule authorization. Gmail, server-side semantic
evaluation and provider actions need it by design: the device cannot decrypt an email body, and the
server holds provider credentials encrypted.

Related: [data flow](../architecture/data-flow.md).
