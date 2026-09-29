---
status: accepted
date: 2026-09-27
owners: mobile
---

# ADR-0015: A Device-Local Derived Store Without Source Text

## Context

[ADR-0014](0014-device-local-classification.md) moved the classification decision onto the device.
The decision is made there; everything it is made _from_, and everything it is recorded _into_, still
lives on the server. `apps/mobile/features/inbox/api/inbox.ts` issues six PostgREST reads on every
inbox load, the React Query cache has no persister, and `record_device_classification_v1` is a
network call. So a phone that captured a notification, holds its text, and can file it by itself
still shows nothing without connectivity, and shows nothing at all on a cold start offline.

The device already has a durable store: `relay-capture.db`, created by `CaptureQueueStore` in the
ingress module. It holds `capture_queue`, the encrypted outbox, and `capture_content`, this device's
readable copy of what a capture said, encrypted under a per-tenant AndroidKeyStore key and bounded to
thirty days. What it does not hold is anything derived — no facts, no events, no classifications, no
categories, no rules — because those were always read back from Supabase.

The readers that need those rows are all JavaScript. Adding them as Kotlin tables would put every
inbox query across the bridge and into a test suite that does not currently run in CI.

## Decision

The app owns a second local database, `relay-local.db`, through `expo-sqlite`, holding the derived
rows the inbox reads. Column names mirror what PostgREST returns, and `tenant_id` takes the place
row-level security holds server-side; every statement supplies one.

**The store holds no source text.** There is no `body` column, and there is no second copy of the
ciphertext. `subject` and `sender` are ordinary columns.

That split is not new. `source_items` already stores `sender`, `subject`, `application_id` and
`occurred_at` as ordinary columns and encrypts only the raw payload into `raw_ciphertext`
(`supabase/migrations/202608240001_initial_schema.sql`). This store draws the same line in the same
place: structured and derived fields are queryable, and the readable copy of what a capture said
stays where it already is, in `capture_content`, read back through `getRetainedCaptureContent`.

So the most sensitive field gains no new home, and nothing that was encrypted becomes unencrypted.
`expo-sqlite` ships no SQLCipher, and adding a cipher would not have changed that boundary — it would
have applied a second protection to fields the server already keeps in plaintext columns while the one
field that needs it already has it.

The forbidden columns are a property of the schema rather than a convention, so
`FORBIDDEN_LOCAL_COLUMNS` is asserted against the migration statements in
`apps/mobile/lib/local-store/schema.test.ts`. A migration that introduces a place to keep source text
fails a test.

Three server invariants are mirrored locally rather than restated informally, because a local store
that disagreed with the database about what is well-formed would produce rows that could never sync:

- one current classification per capture, as a partial unique index on `superseded_at IS NULL`;
- a `device`-origin classification must be `deterministic`, as a check constraint;
- one derivation of a capture per normalizer and extractor version, as a unique index.

Retention is thirty days and two thousand captures — deliberately the same bounds as
`CAPTURE_CONTENT_MAX_AGE_MS` and `CAPTURE_CONTENT_MAX_ITEMS`. The inbox renders a capture's text from
`capture_content`, so a derived row that outlived the content it describes would produce an item
present in the list and empty when opened. Retention is per capture and drops that capture's facts,
event and classification with it. A capture whose `captured_at` cannot be parsed is dropped rather
than kept, because a row whose age cannot be established cannot be shown to be inside the window.

The store is cleared where `clearCaptureQueue` is called — on sign-out and on account deletion — and
the session is cleared last, so a store that could not be cleared leaves the deletion retryable
rather than signing a reader out of an account whose data is still on the phone.

Android is the only platform that captures, so it is the only platform with anything to derive. The
store reports itself unavailable on web rather than opening an emptier second source of truth for a
build that cannot capture.

## Consequences

- Mobile now owns durable derived storage. `docs/architecture/system.md` is amended in the same
  change.
- A rooted device or a device backup can read this database, as it can read any app-private file.
  That is already true of the plaintext columns of `source_items` for anyone with the tenant's
  credentials, and it is why the body is not here.
- Two local databases now exist with different protections and different owners: `relay-capture.db`
  (native, Keystore-encrypted, capture and content) and `relay-local.db` (JavaScript, derived rows).
  The split is along the line of what needs encrypting, not an accident, but it does mean a reader has
  two places to look.
- Migrations are append-only and recorded in `PRAGMA user_version`. Editing an existing migration
  would leave two devices claiming the same version with different tables.
- The store is written by the device's derivation pass, which runs `normalizeSourceFacts` and
  `extractSourceEvents` before upload. Rendering the inbox from it and reconciling classifications
  through it remain separate changes, and sync bookkeeping is deliberately absent from the schema
  until the change that needs it.
- Deriving on the device needed a SHA-256 that Hermes does not have. The fingerprint functions in
  `packages/domain` now take an optional digest instead of assuming `crypto.subtle`, and the app
  supplies one from `expo-crypto`. That is a stated dependency rather than a global polyfill, so the
  package's runtime neutrality stays structural instead of depending on who happened to install a
  shim first. The default is unchanged, so the pipeline is untouched.
- A locally derived event carries a locally generated id, and the server generates a different id for
  the same capture. Nothing depends on that yet, but `hidden_inbox_events` is keyed by event id, so
  reconciliation has to resolve it rather than assume the two agree.
- It does **not** supersede [ADR-0002](0002-cloudflare-processing-boundary.md): no provider call and
  no credential moves to the device.
- It does **not** supersede [ADR-0014](0014-device-local-classification.md). A device-authored
  classification still must never gate a provider effect, and
  `supabase/migrations/202609070001_server_classification_gates_actions.sql` remains the enforcement.
  A locally recorded classification is a local record of the same bounded decision, not a new
  authority.

## References

- [Privacy and data lifecycle](../security/privacy.md)
- [System boundaries](../architecture/system.md)
- [ADR-0014: Device-local classification](0014-device-local-classification.md)
- [expo-sqlite 57.0.3 package metadata](https://www.npmjs.com/package/expo-sqlite/v/57.0.3)
- [SQLite partial indexes](https://www.sqlite.org/partialindex.html)
