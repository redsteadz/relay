---
status: accepted
owner: maintainers
last_verified: 2026-09-04
---

# Issue Dependency Map

GitHub issue bodies own direct dependencies and acceptance criteria. This map records milestone
entry points and cross-milestone flow without copying issue prose.

## M0 Foundation

- [#6 Secret provisioning and KEK rotation](https://github.com/redsteadz/relay/issues/6)
- [#7 Cloudflare resources](https://github.com/redsteadz/relay/issues/7)
- [#9 Supabase projects](https://github.com/redsteadz/relay/issues/9)
- [#10 Expo and EAS builds](https://github.com/redsteadz/relay/issues/10)
- [#11 Local end-to-end harness](https://github.com/redsteadz/relay/issues/11)
- [#65 Retire Graphify CI](https://github.com/redsteadz/relay/issues/65)

## M1 Ingestion

- [#63 Consolidate hosted runtime for current stage](https://github.com/redsteadz/relay/issues/63)
- [#12 Supabase magic-link auth](https://github.com/redsteadz/relay/issues/12)
- [#13 Gmail OAuth](https://github.com/redsteadz/relay/issues/13)
- [#14 Device registration](https://github.com/redsteadz/relay/issues/14)
- [#15 Production source persistence](https://github.com/redsteadz/relay/issues/15)
- [#16 Android encrypted offline queue](https://github.com/redsteadz/relay/issues/16)
- [#17 Dead-letter recovery](https://github.com/redsteadz/relay/issues/17)
- [#18 Gmail Pub/Sub and History](https://github.com/redsteadz/relay/issues/18)
- [#19 Android SMS](https://github.com/redsteadz/relay/issues/19)
- [#20 Android notifications](https://github.com/redsteadz/relay/issues/20)

## M2 Intelligence

- [#21 Typed facts](https://github.com/redsteadz/relay/issues/21)
- [#22 Durable dedupe](https://github.com/redsteadz/relay/issues/22)
- [#23 BYOK OpenAI credentials](https://github.com/redsteadz/relay/issues/23)
- [#24 Custom categories](https://github.com/redsteadz/relay/issues/24)
- [#25 Event extraction](https://github.com/redsteadz/relay/issues/25)
- [#26 Filter compiler](https://github.com/redsteadz/relay/issues/26)
- [#27 Deterministic evaluator](https://github.com/redsteadz/relay/issues/27)
- [#28 Semantic evaluator](https://github.com/redsteadz/relay/issues/28)

## M3 Automations

- [#29 Action approval ledger](https://github.com/redsteadz/relay/issues/29)
- [#30 Nextcloud connection](https://github.com/redsteadz/relay/issues/30)
- [#31 Google Tasks OAuth](https://github.com/redsteadz/relay/issues/31)
- [#32 Nextcloud Budget transactions](https://github.com/redsteadz/relay/issues/32)
- [#33 Google Tasks creation](https://github.com/redsteadz/relay/issues/33)
- [#34 Signed webhooks](https://github.com/redsteadz/relay/issues/34)
- [#35 Durable action workflows](https://github.com/redsteadz/relay/issues/35)

## M4 Product Experience

- [#37 Curated inbox](https://github.com/redsteadz/relay/issues/37)
- [#38 Notification dismissal dry run](https://github.com/redsteadz/relay/issues/38)
- [#39 Privacy and deletion settings](https://github.com/redsteadz/relay/issues/39)
- [#41 Approval and activity UI](https://github.com/redsteadz/relay/issues/41)
- [#42 Category and filter editor](https://github.com/redsteadz/relay/issues/42)
- [#43 Connection controls](https://github.com/redsteadz/relay/issues/43)

## M5 Distribution And Compliance

- [#45 Resilience and disaster recovery](https://github.com/redsteadz/relay/issues/45)
- [#46 SMS distribution](https://github.com/redsteadz/relay/issues/46)
- [#47 Privacy and security audit](https://github.com/redsteadz/relay/issues/47)
- [#48 Gmail verification](https://github.com/redsteadz/relay/issues/48)
- [#49 Release automation](https://github.com/redsteadz/relay/issues/49)

## M6 Cleanup And Finalization

- [#152 Deterministic classification at ingest](https://github.com/redsteadz/relay/issues/152)
- [#153 Gesture-driven inbox interaction](https://github.com/redsteadz/relay/issues/153)
- [#154 Per-application browsing](https://github.com/redsteadz/relay/issues/154)
- [#155 Remove fabricated screen data](https://github.com/redsteadz/relay/issues/155)
- [#156 Navigation drawer](https://github.com/redsteadz/relay/issues/156)
- [#158 Notification dismissal in the reworked surfaces](https://github.com/redsteadz/relay/issues/158)

Primary flow:

```text
M0 environments and keys
  -> M1 authenticated encrypted ingestion
    -> M2 facts, events, and filters
      -> M3 approval-safe provider actions
        -> M4 user controls and explainability
          -> M5 policy, resilience, audit, and release
            -> M6 classification, interaction, and placeholder removal
```

Related: [system architecture](../architecture/system.md) and
[contributor workflow](../../CONTRIBUTING.md).
