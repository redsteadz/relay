---
status: accepted
date: 2026-10-04
owners: mobile
---

# ADR-0016: Glance-First Information Architecture

## Context

Relay's mobile app opened onto the inbox and gave five equal tabs to Inbox, Rules, Sources,
Activity, and Settings. The inbox answers one question — what arrived — and the product's actual
claim is the opposite one: that almost none of what arrived needed the reader. With two hundred
captures and nothing waiting, the first screen was two hundred rows, which is indistinguishable
from the pile Relay exists to remove. A person could only infer that Relay had worked by noticing
the tabs they did not have to open.

Three further problems were visible on a Pixel 7 running the sideload build on 2026-10-04:

- Five equal-flex underlined tabs divided a 1080px phone into columns narrower than their own
  labels, so the fifth ("Categories") was clipped by the edge of the screen: a tab that could be
  neither read nor reached.
- A receipt's title slot carried provenance and its muted subtitle carried the message, so twelve
  captures from one chat rendered as twelve copies of a phone number with the messages greyed out
  beneath, plus a `sender` chip repeating the number a third time. One capture occupied about an
  eighth of the screen and said almost nothing.
- `ContextualNotice` rendered as an unlabelled circled "i" floating above the content on Rules,
  Sources, and Activity, with the privacy boundary it described hidden in a pop-up behind it.

Relay owns a complete token layer and primitive set (ADR-0008), so none of this required a new
dependency or a second styling system. What it required was deciding which screen leads.

## Decision

The app opens on **Today**: a glance that states what arrived, what Relay filed without asking,
what is waiting on a decision, when captures arrived across the day, and which applications
produced the volume. Activity leaves the tab bar and is reached from Today's header, because a
ledger is something a person consults rather than a place they live. The tab bar is Today, Inbox,
Rules, Sources, Settings.

Every number on Today is derived from captures the inbox has already read. No new query, no new
retained field, and nothing displayed that is not displayed elsewhere. The glance is a view over
existing state, not a new store.

Supporting decisions:

- **Captures lead with what they said.** A list row sets the message body as its lead line and
  resolves the sender into the meta line beside the application and arrival time. Where this device
  holds no readable copy, the title leads exactly as before, because it is then the only thing Relay
  can honestly show. Evidence already stated in the row is not chipped again.
- **Rules read as sentences.** A rule card states its compiled plan as "If … then …" rather than
  counting its parts. The condition comes from the compiled plan and not from the author's intent,
  so what is read is what will run, and a plan too branched to read as a clause says how many checks
  it has instead of flattening its logic.
- **Six tints identify, one accent directs.** Categories, sources, and condition types are
  recognised by a hue derived from a stable key. The accent remains reserved for what Relay wants
  acted on. Relay still never claims to know a brand it has not resolved: a tile carries an initial,
  never a borrowed logo.
- **Overflowing tab strips scroll.** Outcome tabs are pills sized by their own content on a
  horizontally scrolling row.
- **Boundaries are stated in place.** `ContextualNotice` is a labelled strip that names its subject
  when collapsed and expands in place. An unlabelled control is not an acceptable carrier for a
  privacy claim.
- **The primary control carries the accent; a destructive control is tonal.** A near-white filled
  button was the loudest element on a dark screen whatever it said, and a solid danger-coloured slab
  made the one irreversible control the most inviting thing on the receipt.

## Consequences

The home screen now makes the product's claim directly and the inbox keeps its job. Density roughly
doubled in the capture list without removing anything a row previously stated.

Today is derived, so it inherits whatever the inbox read: it is empty while the inbox is empty,
unavailable while the inbox is unavailable, and scoped to the reader's own calendar day in their own
time zone. It is deliberately not a second source of truth and must not become one — a count that
cannot be derived from captures already fetched belongs in the ledger, not here.

The tint vocabulary is fixed at six hues in `theme/palette.json`. A screen must not invent a seventh
or choose one per render; `tintNameFor` assigns them, so one category keeps one colour everywhere.

`app/(tabs)/inbox.tsx` resolves to `/inbox` alongside the existing `app/inbox/` detail routes. The
generated `.expo/types/router.d.ts` is written by the dev server rather than by `expo export`, so a
stale copy will reject the href until the dev server has run once.

ADR-0008 still governs the component layer: Paper behind Relay-owned primitives, semantic tokens,
no paid pack and no hosted service. This ADR changes which screen leads and how a capture, a rule,
and a boundary are presented. It does not change that contract.

## Sources

- [ADR-0008: React Native Paper behind Relay UI primitives](0008-mobile-styling-and-components.md)
- [ADR-0015: Device-local derived store](0015-device-local-derived-store.md)
- [Filter model](../architecture/filter-model.md)
