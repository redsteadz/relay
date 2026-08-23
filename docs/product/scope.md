---
status: accepted
owner: product
last_verified: 2026-08-24
---

# MVP Scope

## Included

- Android-first Expo app with custom development/sideload build.
- Gmail testing-user ingestion through OAuth, History API, and Google Cloud Pub/Sub.
- Android notification capture and explicit rule-controlled dismissal.
- Android SMS capture for sideload testing.
- Supabase magic-link identity and tenant-isolated records.
- Dedupe, categories, facts, tasks, reminders, and calendar-like events.
- Natural-language filters compiled to typed predicates with explicit semantic fallback.
- User-supplied OpenAI key encrypted by backend.
- Google Tasks first action provider, followed by Nextcloud Budget and signed webhook.
- Approval by default; per-rule automatic actions.

## Deferred

- Generic IMAP or forwarded-email ingestion.
- iOS access to arbitrary notifications or SMS; platform does not expose equivalent APIs.
- Google Play SMS distribution approval.
- Multi-provider BYOK AI beyond OpenAI.
- Fully autonomous actions or arbitrary user-provided execution code.
- Shared team workspaces and enterprise retention policies.

Related: [Android constraints](../integrations/android.md), [Gmail constraints](../integrations/gmail.md).
