---
status: accepted
date: 2026-08-31
owners: mobile
last_verified: 2026-08-31
---

# ADR-0011: Notification Capture Identity Includes Visible Content

## Context

Android capture adapters assign one envelope UUID before enqueueing, and the pipeline deduplicates on
that identity. SMS derives it from a provider row `_ID`, which names an immutable record, so a retry
or a broadcast follow-up cannot change what the identity refers to.

Notification capture reused that shape over the posting package and Android's notification key. A
notification key does not behave like a provider row. Android reuses one key while rewriting the
notification in place, which is the ordinary mechanism for unread counts, progress, and group
summaries. An edited notification therefore re-entered the pipeline under an existing envelope ID
carrying different facts. Deduplication correctly refused it as `fact_integrity_conflict` and parked
it in the dead-letter store.

Observed on a hosted device: one Gmail group summary stored at `21:19:10Z`, then dead-lettered at
`21:27:55Z` when the same key was rewritten as new mail arrived. Every notification edit after the
first failed this way, so any messaging application would dead-letter continuously.

## Decision

Notification envelope identity is deterministic over the posting package, the notification key, and a
SHA-256 fingerprint of the visible title and text.

Post time is excluded. Including it would mint a new identity for a retry of one unchanged
notification and defeat the idempotency this identity exists to provide. The consequence is that two
notifications sharing a key and visible content deduplicate to one capture; identical content is
treated as one observation.

Relay additionally skips any notification carrying `FLAG_GROUP_SUMMARY`. A grouped application must
post a summary beside its children, that summary only aggregates content the children already carry,
and it is rewritten whenever a child arrives. Capturing it duplicates observations, churns identity,
and widens capture scope for no added signal.

Source items remain immutable observations. An edited notification becomes a distinct source item
rather than a new version of an existing one. Versioned source items were rejected: they require a
schema and pipeline change to express a distinction no consumer reads today.

## Consequences

An unchanged redelivery stays idempotent, and an edit becomes its own observation instead of a
dead-letter. Downstream consumers may see several source items describing one evolving notification
and must treat them as separate observations of the same slot rather than as duplicates.

Identity changed shape, so envelope IDs minted before this decision do not match IDs minted after it
for the same notification. Dead-lettered items carrying a pre-change identity conflict again if
replayed and are discarded rather than retried.

This decision covers notification identity only. SMS identity continues to follow the provider row
described in [Android notifications and SMS](../integrations/android.md).

## Sources

- [Android notification and SMS integration](../integrations/android.md)
- [End-to-end data flow](../architecture/data-flow.md)
- [Android notification grouping](https://developer.android.com/develop/ui/views/notifications/group)
