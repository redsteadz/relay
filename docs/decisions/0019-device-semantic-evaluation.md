---
status: accepted
date: 2026-10-08
owners: maintainers
---

# ADR-0019: Device Semantic Evaluation

## Context

[ADR-0014](0014-device-local-classification.md) put deterministic classification on the device and
recorded the limit plainly: the device "never holds the tenant's model credential, so a semantic
clause is reported as awaiting a model and files nothing". Everything semantic therefore waits for
`apps/pipeline`, which holds the encrypted BYOK key and makes the provider call.

That boundary has two costs, and the second one was only discovered when
[ADR-0017](0017-notification-dismissal-after-posting.md) shipped.

**A semantic rule dead-ends on the device.** `classifyCapture` returns `awaiting-model` and the
capture stays unfiled until the pipeline gets to it. The inbox says "a rule needs a model to decide
this one", which is accurate and useless.

**A semantic rule can never quiet a notification.** The quiet decision runs in
`RelayNotificationListenerService`, with the app dead and no session. With the credential server-side
the listener cannot consult a model, and a verdict that arrives after upload lands minutes to hours
later — long after the notification was posted and read. So notification quieting was restricted to
deterministic rules, which is a severe restriction on a product whose premise is sorting what matters
from what does not: "what matters" is frequently a semantic judgement.

The restriction was presented as a platform limit. It is not. A BYOK semantic call is an HTTPS
request to an OpenAI-compatible endpoint, and a phone can make one. `semanticEndpointOverrideSchema`
already carries `baseUrl`, and [ADR-0012](0012-openai-compatible-semantic-endpoint.md) already
accepts any OpenAI-compatible endpoint — including a model running on the reader's own machine. What
stood in the way was an architecture boundary, not a capability.

Two further facts make moving it cheap rather than expensive:

- The privacy-critical logic is already portable. `minimizeSemanticDisclosure` and
  `resolveSemanticDecision` live in `packages/domain`, which that package's contract requires to be
  pure and runtime-neutral. The field allowlist, the redaction, the bounding and the confidence
  threshold can run on the device unchanged, so there is no second implementation of redaction to
  keep in step.
- `parseSemanticBaseUrl` already normalizes and validates an endpoint for both `apps/api` and
  `apps/pipeline`.

## Decision

The device evaluates semantic clauses itself, against an endpoint the reader configures. The server
path remains, as an option rather than the only way.

### Local by default, server by choice

A reader supplies an OpenAI-compatible endpoint and, if it needs one, a key. Local is the default
because it is the stronger privacy position: the notification text reaches a model the reader runs,
on hardware they own, and leaves no network they do not control. The server path stays for the reader
who wants semantic filtering without hosting a model, and is gated behind the Pro entitlement that
[#201](https://github.com/redsteadz/relay/issues/201) introduces — it spends Relay's hosted runtime
and the pipeline's provider call, so it is the paid convenience rather than the baseline.

Both paths run the same `packages/domain` code over the same allowlist and redaction. Which endpoint
answered is recorded on the disclosure, so history says where data actually went.

The server path is an explicit opt-in rather than an inference from a stored key. `serverEvaluation`
on the OpenAI connection's metadata is written only by
`PUT /api/connectors/openai/server-evaluation` and read by the pipeline before the credential is
unwrapped; off yields the fixed reason `server-evaluation-disabled`, distinct from
`credential-missing`. It defaults to off, including for a credential stored before the flag existed,
because holding a key is consent to Relay holding it and not consent to Relay spending it. A reader
who wants only the device to use their key stores it once and leaves this off.

The gate on turning it on is **presentational today, and that is a known gap**. The Pro entitlement
lives in RevenueCat and on the device; no server-side record of it exists, so the route is reachable
by any authenticated tenant. [#201](https://github.com/redsteadz/relay/issues/201) owns syncing the
entitlement, and the route and the UI both say so rather than implying an enforcement boundary that
is not there. What _is_ enforced is the opt-in: without it the pipeline does not use the key at all.

One consequence worth stating plainly: a rule over an email body cannot be decided on the device.
Gmail keeps its body only in `raw_ciphertext`, encrypted to a key the device does not hold, so
semantic rules over email are exactly the case the server path exists for.

### The device credential is device-local

The key the device uses is held in `expo-secure-store`, Keystore-backed, and is never uploaded. It is
**not** the server's BYOK credential: the API stores that encrypted and never returns it, which is
correct and stays that way. A reader who uses both paths configures both, and the server never learns
the device's key nor the device the server's.

This amends ADR-0014's "never holds the tenant's model credential" for the device's own endpoint
only. ADR-0002's processing boundary is untouched: no Relay service credential and no provider
operation moves to the device, and the device still cannot select an endpoint, a credential or an
action — the reader configures the first two and the rule fixes the third.

### The endpoint policy inverts for a device caller

`parseSemanticBaseUrl` refuses private and link-local hosts, because server-side a tenant-supplied
base URL is an SSRF primitive: it would "turn semantic evaluation into a probe of whatever the
runtime can reach". That reasoning does not transfer to the phone. The device is _on_ the network in
question and is making a request its owner configured; there is no confused deputy to exploit, and
the only reachable things are the reader's own. Refusing `192.168.1.10:11434` there would forbid
precisely the configuration this decision exists to enable.

So the parser gains an explicit `allowLocalNetwork` option, which only a device caller passes. It
permits plain HTTP to loopback and to the address ranges a self-hosted model actually lives on —
RFC1918, CGNAT (which is how a Tailscale host is reached), link-local, and the `.local` / `.internal`
/ `.home.arpa` names mDNS hands out. It does not relax anything else: embedded credentials, query
strings and fragments stay refused on both paths, for the same reason as before — a base URL that can
carry a credential smuggles one into every log and disclosure that names the endpoint. Addresses no
model is ever hosted on (`0.0.0.0/8`, multicast, the documentation ranges) stay refused too, so the
option widens a named set rather than removing a check.

The server keeps the strict policy. It is the same function with a different argument, not a second
rule.

### Deterministic predicates still run first, and now that is load-bearing

[ADR-0003](0003-deterministic-before-ai.md) ordered deterministic evaluation before any model call.
On the device that stops being only a privacy preference and becomes the thing that makes this
affordable: the listener evaluates the deterministic part in its own process, and a notification only
reaches a model if it already matched — including the explicit `source.applicationId` predicate that
[#38](https://github.com/redsteadz/relay/issues/38) requires of any rule that may act. So the model
is consulted for notifications from applications the reader named, that already passed every literal
test, and for nothing else. That bounds the cost, the latency and — most importantly — what is ever
sent anywhere.

### A semantic match is still not an AI-authorized action

`AGENTS.md` holds that "AI cannot select an endpoint, credential, provider operation, or irreversible
action", and [the action model](../architecture/action-model.md) that "AI-only matches cannot dismiss
automatically". Neither is relaxed. A rule that quiets a notification must still name an application
explicitly, compile to something the device can evaluate, observe a server-clocked dry run, present a
reviewed match/miss history, be explicitly enabled, and remain under the kill switches. The model
answers one question inside a scope a person wrote and reviewed; it never chooses the application, the
action, or whether the rule is allowed to act. A match is therefore never AI-alone, which is what
that invariant is about.

Cancellation is **not** restricted to deterministic rules. The alternative — semantic rules may
snooze but never cancel — was considered, since it would keep the invariant intact in letter as well
as substance. It was rejected as a distinction without a safeguard: the gates above are what make an
irreversible act safe, and they apply identically either way. The reader who wants that restriction
has it already, by writing the rule to snooze.

### Where the call happens

In JavaScript, never in Kotlin. The redaction and minimization are privacy-critical and already exist
once, in TypeScript; a Kotlin port would be a second implementation of the rule that decides what
leaves the device.

That settles the sequence for notification quieting. The listener decides the deterministic part in
process, and when a matched rule carries a semantic clause it records the notification as
`awaiting-model` and leaves it alone.

### Quieting a semantic rule is deferred, not immediate

The pass that finishes the decision runs when the app next runs: on open, or on the background
delivery task's fifteen-minute floor ([ADR-0018](0018-background-capture-delivery.md)). It reads the
candidates, asks the configured model, and hands each answer to a native function that re-reads the
rule, the kill switch and the application scope before touching anything.

Starting a headless JavaScript task from inside the listener was the intended design and was
attempted first. It was rejected on implementation: driving Expo's headless app loader from a bound
`NotificationListenerService` requires a custom `TaskConsumer` against Expo internals that are not
public API, and its failure mode — a JavaScript runtime that does not start, inside a system-bound
service — is invisible until it is on hardware. A deferred act that is honest about being late is
better than an immediate one that silently does not happen.

This is a real reduction in what the feature does, and it is stated in the product copy rather than
glossed. A deterministic quiet rule still acts within milliseconds of the notification posting. A
semantic one acts on the next pass, which may be a quarter of an hour later, and by then the reader
may have dealt with the notification themselves. That outcome has its own recorded verdict,
`no-longer-posted`: the rule matched, Relay was authorized, and there was nothing left to quiet.
Recording `snoozed` there would make the ledger a person reviews claim an act that never happened.

Two properties make the deferral tolerable. The phone has already made its sound either way — ADR-0017
is the record of that — so the deferral costs the removal of a notification from the shade, not the
interruption. And the reversible action is the default: a snooze that lands late costs a delay.

Nothing in the deferred path decides whether Relay may act. The model's answer crosses back as a
boolean, and the native side re-derives the authorization from the current snapshot, so a reader who
engaged the kill switch, paused the application or edited the rule while a model was thinking is
obeyed rather than raced. Finding the notification again uses no stored notification key: the listener
re-derives capture identity across `activeNotifications` with the same function that recorded it,
which also means an edited notification is correctly not found — the rule was judged against what it
said at the time.

## Consequences

- A semantic rule files captures on the device, so `awaiting-model` stops being a terminal state for
  a reader who has configured an endpoint. For a reader who has not, nothing changes.
- The device can send notification text to an endpoint. This is the significant new privacy surface,
  and it is why local is the default, why the allowlist and redaction are reused rather than
  reimplemented, and why the disclosure records the host that answered.
- Disclosure recording is an obligation this creates and
  [#205](https://github.com/redsteadz/relay/issues/205) shows is unmet on the existing path:
  semantic disclosures are never recorded today. The device path records its own from the start, in
  the device-local store per [ADR-0015](0015-device-local-derived-store.md), and the disclosure
  history reads both. This does not fix #205 for the pipeline, and must not be mistaken for having
  done so.
- A model that is slow or unreachable must not block anything. A device semantic evaluation that
  fails leaves the capture awaiting a model, exactly as before, and leaves a notification alone. No
  answer is never handed over as an answer of no: the candidate keeps its row and a later pass tries
  again.
- A semantic quiet rule acts late, by a pass rather than on arrival, and the quiet review shows
  `awaiting-model` and `no-longer-posted` as ordinary outcomes. A reader who needs a notification
  removed the instant it posts needs a deterministic rule.
- A local endpoint on a LAN is reachable only while the phone is on that network. A rule that depends
  on it stops deciding when the reader leaves the house, which is a property of their configuration
  rather than a fault, and is reported as awaiting a model rather than as an error.
- Two credentials can exist for one tenant. The device's is device-local and the server's is
  encrypted server-side; neither is derivable from the other, and revoking one does not revoke the
  other. The privacy screen has to say so.
- The strict SSRF policy continues to apply to every server-side caller, unchanged and asserted by
  the existing tests.

## Supersedes

Amends [ADR-0014](0014-device-local-classification.md): the device may hold a model credential for
its own configured endpoint, and may evaluate semantic clauses. It does **not** amend that ADR's
other limits — a device-authored classification still must never gate a provider effect, and the
device still may not hold a Relay service credential.

Amends the quieting restriction in [ADR-0017](0017-notification-dismissal-after-posting.md): a rule
carrying a semantic clause may be authorized to act on a notification, under every gate that ADR and
#38 already impose. The compiler's refusal of `category`, `body`, `sender`, negation and unbounded
application predicates is unchanged.

Does not supersede [ADR-0003](0003-deterministic-before-ai.md) or
[ADR-0012](0012-openai-compatible-semantic-endpoint.md); it relies on both.

## References

- [Filter model](../architecture/filter-model.md)
- [OpenAI (BYOK)](../integrations/openai.md)
- [Privacy and data lifecycle](../security/privacy.md)
- [Threat model](../security/threat-model.md)
- [Android notifications and SMS](../integrations/android.md)
