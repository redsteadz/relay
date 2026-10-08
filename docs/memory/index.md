---
status: accepted
owner: maintainers
last_verified: 2026-08-30
---

# Relay Memory Index

This page is canonical map, not duplicate specification. Follow links to authoritative records.

## Product

- [Vision and principles](../product/vision.md)
- [MVP scope and exclusions](../product/scope.md)

## Architecture

- [System boundaries](../architecture/system.md)
- [End-to-end data flow](../architecture/data-flow.md)
- [Filter model](../architecture/filter-model.md)
- [Action and approval model](../architecture/action-model.md)

## Security

- [Privacy and data lifecycle](../security/privacy.md)
- [Error handling and observability](observability.md)
- [Threat model](../security/threat-model.md)
- [Secret provisioning and KEK rotation](../security/key-rotation.md)

## Integrations

- [Android notifications and SMS](../integrations/android.md)
- [Gmail](../integrations/gmail.md)
- [OpenAI (BYOK)](../integrations/openai.md)
- [Google Tasks](../integrations/google-tasks.md)
- [Nextcloud Budget](../integrations/nextcloud-budget.md)
- [Signed webhooks](../integrations/webhook.md)

## Decisions

- [ADR-0001: TypeScript monorepo](../decisions/0001-typescript-monorepo.md)
- [ADR-0002: Cloudflare processing boundary](../decisions/0002-cloudflare-processing-boundary.md)
- [ADR-0003: Deterministic filters before BYOK AI](../decisions/0003-deterministic-before-ai.md)
- [ADR-0004: Development and release branches](../decisions/0004-development-release-branches.md)
- [ADR-0005: Versioned wrapping keys](../decisions/0005-versioned-wrapping-keys.md)
- [ADR-0006: Shared Supabase hackathon backend](../decisions/0006-shared-supabase-hackathon-backend.md)
- [ADR-0007: Shared hosted runtime](../decisions/0007-shared-hosted-runtime.md)
- [ADR-0008: Mobile styling and components](../decisions/0008-mobile-styling-and-components.md)
- [ADR-0009: Local Android capture diagnostics](../decisions/0009-local-android-capture-diagnostics.md)
- [ADR-0010: Fact-only event extraction](../decisions/0010-fact-only-event-extraction.md)
- [ADR-0011: Notification capture identity](../decisions/0011-notification-capture-identity.md)
- [ADR-0012: OpenAI-compatible semantic endpoint](../decisions/0012-openai-compatible-semantic-endpoint.md)
- [ADR-0013: Text-derived facts](../decisions/0013-text-derived-facts.md)
- [ADR-0014: Device-local classification](../decisions/0014-device-local-classification.md)
- [ADR-0015: Device-local derived store](../decisions/0015-device-local-derived-store.md)
- [ADR-0016: Glance-first information architecture](../decisions/0016-glance-first-information-architecture.md)
- [ADR-0017: Notification dismissal after posting](../decisions/0017-notification-dismissal-after-posting.md)
- [ADR-0018: Background capture delivery](../decisions/0018-background-capture-delivery.md)
- [ADR-0019: Device semantic evaluation](../decisions/0019-device-semantic-evaluation.md)
- [ADR-0020: Quiet rules need not name an application](../decisions/0020-unscoped-quiet-rules.md)

## Delivery

- [GitHub issue dependency map](issue-map.md)
- [Contributor workflow](../../CONTRIBUTING.md)
- [Cloudflare environments and operations](../operations/cloudflare.md)
- [Supabase environments and operations](../operations/supabase.md)
- [Mobile wireless ADB](../operations/mobile-wireless-adb.md)
- [Demo build](../operations/demo-build.md)

When generated locally, Graphify output indexes these documents and code for discovery. It is not CI
evidence or an authority over contracts, migrations, or accepted ADRs.
