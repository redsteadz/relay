---
status: accepted
date: 2026-10-09
owners: maintainers
---

# ADR-0020: Quiet Rules Need Not Name An Application

## Context

[#38](https://github.com/redsteadz/relay/issues/38)'s first acceptance criterion is that a rule
naming no application cannot act on a notification, and
[ADR-0017](0017-notification-dismissal-after-posting.md) carried it into the schema, the routine and
the compiler. [ADR-0019](0019-device-semantic-evaluation.md) then let a rule carrying a semantic
clause quiet a notification, but only alongside a deterministic part — so "marketing **from the
courier app**" worked and "marketing" did not.

The justification given for the requirement was that a rule with no literal predicate would mean
asking a model about every notification, which [ADR-0003](0003-deterministic-before-ai.md) exists to
prevent. **That justification does not survive contact with the code.**

`evaluateFilterPlan` skips the deterministic branch entirely when `plan.deterministic` is undefined
and returns `undecided` whenever a semantic clause exists. So a purely descriptive rule _already_
produces a model call per capture on the filing path, and has since semantic filing shipped. The
cost argument does not distinguish quieting from filing; it describes both.

Nor was the scope claim accurate. `onNotificationPosted` returns before `actIfAuthorized` unless
`capturable()` passes, so quieting only ever sees notifications inside the capture allowlist — the
same set filing works on. "Every notification from every app" was never the exposure; "every
notification Relay already captures" was.

What remains of the original reasoning is narrower and real: filing is reversible and stays inside
Relay, while quieting changes the phone and `dismiss` cannot be undone. The application predicate
was a consent scope — _which_ notifications Relay may touch — rather than a cost control.

## Decision

A quiet rule no longer has to name an application. The maintainer's call, made with the consent-scope
tradeoff stated: deciding "is this marketing?" across what Relay already captures is one of the
product's main features, not an evasion of a safeguard.

A plan with no deterministic part compiles to a rule with **no clauses**, which every captured
notification satisfies. The model then decides each one through the deferred path ADR-0019 built.

### The gates that remain

Everything that made the capability safe except the predicate itself:

- the capture allowlist, which still decides which applications are seen at all;
- a server-clocked 72-hour dry run that must observe something before it can complete;
- a reviewed match/miss history, and an explicit enable transition with an audit record;
- the tenant-wide kill switch, the per-application pause, and revoking listener access;
- `snooze` as the default action, which Android reverses on its own.

None of these depended on an application being named, which is what makes dropping it a narrowing of
the rule's description rather than of its safety.

### `unscoped` is carried, not inferred

The compiled rule holds an explicit `unscoped` boolean, redundant with `clauses.length === 0`, and
the contract and the Kotlin parser both refuse a rule whose flag and shape disagree. An empty
disjunction read as "matches everything" is the classic fail-open bug: a clause a parser gave up on,
or a compiler branch that produced none, would silently widen a rule that cancels notifications to
the whole shade. Carrying the intent separately makes that failure refuse instead of act.

An unscoped rule must also carry `awaitsModel`. Nothing literal narrows it, so without a model
deciding it, it would act on everything unconditionally — which is exactly what a lost semantic
clause looks like.

### What is still refused

A plan with neither a deterministic nor a semantic part. It decides nothing and would act on
everything. `filter_rules.plan` is a bare `jsonb not null` with no shape constraint, so
`dismissible_filter_rule` is the only thing standing between such a row and an authorization.

The device-evaluability refusals are unchanged: negation, `sender`, `body`, `category`,
`attributes.*`, an expression that matches nothing, and anything past the clause and test bounds.

## Consequences

- A reader can write "marketing" or "communication" and have it quiet notifications, which is the
  case the feature exists for and the one that prompted this.
- **The dry-run ledger of an unscoped rule spans every application Relay captures for that tenant.**
  ADR-0017 said the ledger "cannot become a log of every app a person uses"; for a tenant who writes
  an unscoped rule, within the capture allowlist, it now can. The allowlist is the reader's own
  choice, Relay already stores those captures, and the ledger holds no title, text or sender — so it
  adds no category of data the device did not already hold. It is still a real change and is recorded
  rather than glossed.
- A model that answers badly now has wider reach. The dry run, the review and the stops are what
  bound that, and the quiet screen states an unscoped rule's reach on its row so the breadth is read
  before it is authorized rather than discovered after.
- `filter_expression_binds_application` and the `unbounded-application` refusal are deleted rather
  than left unused. The migration is unmerged, so there is no deployed caller to consider.
- `#38`'s first acceptance criterion is contradicted. It is not reinterpreted: this ADR is the record
  that it was dropped, and why.

## Supersedes

Amends [ADR-0017](0017-notification-dismissal-after-posting.md): the explicit application predicate
is no longer required for a rule to act on a notification. Every other gate in that ADR stands,
including the post-posting limitation that is its main subject.

Amends the deterministic-part requirement in
[ADR-0019](0019-device-semantic-evaluation.md): a plan that is only a semantic clause is now
authorizable and compiles to an unscoped rule. The ordering that ADR relies on is unchanged — any
literal predicates a rule does have are still evaluated before a model is asked.

Does not supersede [ADR-0003](0003-deterministic-before-ai.md). Deterministic predicates still run
first wherever they exist; this records that for a rule with none, they never did, on either path.

## References

- [Filter model](../architecture/filter-model.md)
- [Android notifications and SMS](../integrations/android.md)
- [Privacy and data lifecycle](../security/privacy.md)
