---
status: accepted
owner: integrations
last_verified: 2026-08-24
sources:
  - https://developers.google.com/gmail/api/guides/push
---

# Gmail

Relay uses separate connector OAuth rather than treating Supabase login as mailbox authorization.
MVP runs with allowlisted Google OAuth testing users while production verification is prepared.

Gmail `watch` publishes mailbox cursor notifications through Google Cloud Pub/Sub. Push payloads
contain email address and History ID, not message content. Relay verifies Pub/Sub push identity,
resolves connector ownership, serializes each mailbox cursor through a Durable Object, and calls
Gmail History API with encrypted refresh credentials.

Watches expire within seven days and should renew daily. Push delivery can be delayed or dropped;
periodic History reconciliation remains required. Per-user notification rate is limited, so cursors
must coalesce rather than assume one push per message.

Required release work includes minimum-scope analysis, OAuth verification, Google API Services User
Data Policy review, deletion behavior, and documented disclosure before Gmail data can reach OpenAI.
Foundation callback returns `501` until Pub/Sub JWT verification and connector ownership resolution
are implemented together; it never acknowledges an unverified push.
