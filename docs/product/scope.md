---
status: accepted
owner: product
last_verified: 2026-08-29
---

# MVP Scope

## Included

- Android-first Expo app with custom development/sideload build.
- Gmail testing-user ingestion through OAuth, History API, and Google Cloud Pub/Sub.
- Android notification capture and explicit rule-controlled dismissal.
- Android inbox SMS capture for explicitly consented sideload testing, limited by exact sender
  allowlists and independently pausable/deletable device queues. Debug sideloads may preview their
  encrypted local SMS queue without authentication or upload.
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
- A Play-safe Android profile; when introduced it must inherit the current permission-free build
  branch and omit SMS permissions and background components.
- Multi-provider BYOK AI beyond OpenAI.
- Fully autonomous actions or arbitrary user-provided execution code.
- Shared team workspaces and enterprise retention policies.

Related: [Android constraints](../integrations/android.md), [Gmail constraints](../integrations/gmail.md).
