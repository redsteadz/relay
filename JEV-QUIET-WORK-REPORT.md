# Relay: quiet-on-the-rule and device-model diagnostics

Working report for the uncommitted changes on `dev` in `~/Projects/relay` (2026-10-23).
Not part of the repo's docs; delete or move once read.

## 1. The ask

1. Remove the separate Quiet screen and make "what happens to a matching notification" a
   choice on each rule, including which kind (snooze vs dismiss).
2. Make the device-model ("local LLM" / Jev) call path diagnosable when it fails.
3. Diagnose why rules kept saying "waiting on model" with no request ever reaching the
   provider (nothing on the OpenRouter dashboard).

## 2. Diagnosis

### 2.1 The Jev preset pointed at the wrong host

- The preset used `https://thejevai.com/v1`. That is the product website, not an API.
- The real endpoint is `POST https://api.typesafe.ai/v1/systemone`. It needs a bearer key
  (`Authorization: Bearer <TYPESAFE_API_KEY>`, keys from console.typesafe.ai).
- Request body Relay already sends is correct:
  `{ model: "jev-latest", state, questions: { <key>: { type: "noul", instructions } } }`.
  Response is `answers.<key>.noul` (0..1, no `confidence` field for noul).
- So every Jev request hit a web server and was recorded as a refusal. Only the address
  was wrong. The code in `packages/domain` (`systemOneRequestBody`,
  `parseSystemOneEvaluation`) did not need changing.
- Note: the stored device-model config on the phone still has the old address. Re-select
  the Jev preset once after installing.

### 2.2 Refusals were written where nothing displayed them

- Each failed device evaluation was written to the device-local `ai_disclosures` table
  with a `failure_reason`.
- No screen read that table. The Disclosure history screen reads server disclosures only.
- Result: "waiting on your model" forever, with the reason sitting in a table nobody saw.

### 2.3 The quiet pass had four silent exits before any request

`resolvePendingSilencesForTenant` returned 0 with no record in each of these cases:

| Gate                                                               | What was happening                                                                                                | Visible to the user? |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------- |
| Listener granted but not bound                                     | Common after a dev-client reinstall. The shade cannot be read, so no candidates are offered and nothing is asked. | No                   |
| No device model configured                                         | Pass exits immediately.                                                                                           | No                   |
| Candidate's retained text expired, or its rule edited/paused since | Candidate skipped with `continue`, forever.                                                                       | No                   |
| Every pending candidate already swiped away                        | Nothing to resolve.                                                                                               | No                   |

### 2.4 OpenRouter

- OpenRouter accepts the request shape Relay sends for the `openai` protocol
  (`max_completion_tokens` is supported).
- A missing dashboard entry therefore means one of the gates in 2.3 stopped the pass before
  a request left the phone. The new diagnostics page shows which one.

## 3. Plan that was executed

1. Give every evaluator outcome a duration, protocol and HTTP status, plus a plain-language
   explanation per status code.
2. Add a bounded, content-free journal of model passes (what triggered it, where it stopped,
   counts, per-request host/model/protocol/duration/status/refusal).
3. Expose listener-bound state and pending-candidate count from the native module so the
   app can tell "not granted" from "granted but not connected".
4. Build a "Model on this phone" diagnostics page with a live probe ("Ask now"), a manual
   "Run the quiet pass now", the journal, and the device's own disclosure rows.
5. Move the quiet choice into the rule editor as a stage; add a stop switch and per-rule
   pills on the Rules tab; delete the Quiet screen and its Settings card.
6. Fix the Jev preset host.
7. Record the design as ADR-0023; update related docs.

## 4. What changed

### 4.1 Quiet lives on the rule now

- **Rule editor** (`apps/mobile/app/rules/editor.tsx`): new stage 6 "What it does to the
  notification" with four choices: leave it (`none`), watch first (`observe`), put away for
  two hours (`snooze`), clear for good (`dismiss`).
  - Choices are computed from the draft's own compilation
    (`compileNotificationSilenceRule`), so a rule the device would refuse is explained
    before saving.
  - Shows the rule's recent verdicts (up to 10) with notification titles, and per-app
    Android notification settings links.
  - A verdict stuck at "waiting on your model" shows the latest quiet pass's explanation
    inline with a "Check the model" link.
  - Save flow: `effective = blocked ? "none" : chosen`. A quiet-only change applies to the
    current revision rather than appending a new one. Going from `observe` to `none`
    appends a revision (withdraws authorization).
- **Rules tab** (`apps/mobile/app/(tabs)/automations.tsx`): stop switch surface ("Stop
  clearing notifications") shown whenever any rule is acting/observing or the kill switch
  is engaged; listener warning; a quiet pill on each `RuleRow`.
- **Hook** (`features/silence/hooks/useNotificationSilence.ts`): new `applyChoice`
  mutation: `observe` starts a dry run; `none` withdraws; `snooze`/`dismiss` optionally
  completes the dry run with native counts, then sets dismissal with that action.
- **Presentation** (`features/silence/models/silencePresentation.ts`): `QuietChoice`,
  `QUIET_CHOICES`, `quietChoiceLabel`, `quietChoiceFor`, `quietStageState`, `quietPill`,
  `actingSentence`, `applicationsNamedBy`.
- **New component** `features/silence/components/QuietRuleStage.tsx`.
- **Removed**: `app/quiet.tsx`, `features/silence/components/QuietScreen.tsx`, the
  Safeguards/Quiet card in Settings. `app/sources/notifications/index.tsx` now points to
  the Rules tab.
- Structural boundary test (`dismissalBoundary.test.ts`) still passes: no forbidden
  native capability strings under `app/(tabs)`, `features/inbox`, `app/inbox`,
  `components`.

### 4.2 The device-model path is diagnosable

- **Evaluator** (`lib/device-semantic.ts`): `DeviceSemanticResult` now carries
  `durationMs`, `protocol`, `statusCode`. New `deviceSemanticStatusExplanation(status)`
  (401/403 key, 404 route or kind, 400/422 model name, 429, 5xx) and
  `deviceSemanticResultExplanation(result)`.
- **Journal** (`lib/device-semantic-diagnostics.ts`, new): AsyncStorage key
  `relay-model-journal.<tenantId>`, last 12 passes, 8 attempts per pass. Outcomes:
  `evaluated | failed | no-candidates | none-posted | not-configured | shade-unreadable |
store-unsupported`. Counts: `acted, candidates, evaluated, skippedNoContent,
skippedRuleGone, undecided`. Helpers: `journaledDeviceModelPass`, `probeDeviceModel`
  (one synthetic marketing notification), `subscribeDeviceModelJournal`,
  `clearDeviceModelJournal`. No bodies, URLs or keys are stored; host and model name only.
- **Quiet pass** (`features/silence/api/silenceResolution.ts`): takes a `trigger`
  (`background | foreground | manual`), journals every run, and classifies the no-candidate
  case using native capabilities: pending 0 means `no-candidates`; otherwise listener
  unbound means `shade-unreadable`, else `none-posted`.
- **Resolution core** (`lib/notification-silence-resolution.ts`): returns counts for each
  former silent `continue` plus an `attempts` list.
- **Filing pass** (`features/inbox/api/semanticFiling.ts`,
  `lib/device-semantic-filing.ts`): journaled the same way.
- **Diagnostics page** (`app/device-model.tsx`, "Model on this phone"; reached from Your
  data via the "Check it is answering" button on `DeviceModelPanel`):
  - Live listener state: not granted vs granted-but-not-connected vs connected.
  - "Ask now" probe: decision, duration, HTTP status, explanation.
  - "Run the quiet pass now".
  - Journal of recent passes with per-attempt lines such as
    "Sent to jev-latest at api.typesafe.ai as a decision engine · 1.3 s · HTTP 401 · rejected".
  - The device's own `ai_disclosures` rows.
  - Clear journal.
  - Files: `features/privacy/hooks/useDeviceModelDiagnostics.ts`,
    `features/privacy/components/DeviceModelDiagnostics.tsx`,
    `features/privacy/models/deviceModelDiagnosticsPresentation.ts`.
- **Jev preset** (`features/privacy/models/deviceModelPresentation.ts`):
  `baseUrl: "https://api.typesafe.ai/v1"`, label "Jev (TypeSafe, hosted)", model
  `jev-latest`, protocol `system-one`.

### 4.3 Native (Kotlin) changes, needs a dev-client rebuild

- `RelayNotificationListenerService.kt`: companion `fun isBound(): Boolean`.
- `CaptureQueueStore.kt`: `fun pendingSilenceCount(tenantId: String): Int`.
- `RelayDeviceIngressModule.kt`: `getCapabilities` adds `notificationListenerBound` and
  `notificationSilencePendingCount`.
- TypeScript (`modules/relay-device-ingress/src/RelayDeviceIngressModule.ts`) treats both
  as optional, so the JS bundle runs against the old native build and reports "this build
  cannot tell" instead of guessing.
- Could not compile Kotlin here (no Android SDK). The diff is three small additions.

### 4.4 Docs

- New `docs/decisions/0023-quiet-on-the-rule-and-model-diagnostics.md`.
- `docs/memory/index.md` lists ADR-0023.
- `docs/integrations/android.md` quiet paragraphs updated.
- `docs/decisions/0022-decision-engine-endpoints.md` host corrected to `api.typesafe.ai`.

### 4.5 Tests

- New: `lib/device-semantic-diagnostics.test.ts`,
  `features/privacy/models/deviceModelDiagnosticsPresentation.test.ts`.
- Extended: `device-semantic.test.ts`, `notification-silence-resolution.test.ts`,
  `filterPresentation.test.ts`, `deviceModelPresentation.test.ts`,
  `silencePresentation.test.ts`; `disclosures.test.ts` fixtures gained `durationMs`.

## 5. Verification

Run inside `apps/mobile` unless noted. Shared packages must be built first (see 7).

| Check                                         | Result                            |
| --------------------------------------------- | --------------------------------- |
| `npx tsc --noEmit`                            | clean                             |
| `npx eslint app features lib modules`         | clean                             |
| `npx vitest run`                              | 63 files, 1092 tests, all pass    |
| `npx pnpm@11.23.0 format:check` (repo root)   | clean                             |
| Stale references to `/quiet` or `QuietScreen` | none                              |
| `git status --short \| wc -l`                 | 42 changed/new files, uncommitted |

Not verified: Kotlin compilation and on-device behavior.

## 6. To verify on the phone

1. Rebuild the Android dev client (needed for the two new capability fields).
2. Open Your data, tap "Check it is answering". Confirm the listener line says connected.
   If it says granted but not connected, toggle Relay's notification access off and on.
3. Re-select the Jev preset (stored address is still the old one), enter the TypeSafe key,
   tap "Ask now". Expect a yes decision in under a second with HTTP 200.
   - HTTP 401/403 means the key is wrong or missing.
   - HTTP 404 means the address or protocol kind is wrong.
4. Write a rule with a semantic clause, choose "Put away for two hours" in the editor,
   trigger a matching notification, then "Run the quiet pass now" and read the journal
   entry. It names the gate if nothing was asked.

## 7. Toolchain notes

```
npx pnpm@11.23.0 install --frozen-lockfile
npx pnpm@11.23.0 --filter "@relay/contracts" --filter "@relay/domain" \
  --filter "@relay/observability" --filter "@relay/crypto" build
cd apps/mobile && npx vitest run && npx tsc --noEmit && npx eslint app features lib modules
```

- Nothing has been committed. Branch is `dev`.
- Repo rule (AGENTS.md): no `Co-Authored-By: Claude` or any AI-tool trailer on commits, and
  no "Generated with Claude Code" footer on PR bodies.

## 8. Sources

- Jev / System One contract: https://zuplo.com/docs/ai-gateway/jev.md and
  https://flaviocopes.com/jev-api-key/
- OpenRouter parameter support:
  https://reference.langchain.com/javascript/langchain-openrouter/OpenRouter/ChatGenerationParams
  and https://www.effect.website/docs/v4/api/ai-openrouter/OpenRouterLanguageModel
