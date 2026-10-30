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

[ADR-0014](0014-device-local-classification.md) moves deterministic classification onto the device.
That does not move any part of this boundary: the device never calls a provider or holds a service
credential, and ADR-0014 says so explicitly in its own "does not supersede" note.

Related: [data flow](../architecture/data-flow.md).
