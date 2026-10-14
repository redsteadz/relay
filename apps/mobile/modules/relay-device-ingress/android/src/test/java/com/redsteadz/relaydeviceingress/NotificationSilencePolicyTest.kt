package com.redsteadz.relaydeviceingress

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What Relay will and will not quiet.
 *
 * The decision reached here silences or cancels a notification, and a reader cannot undo either, so
 * every refusal below is a case where acting would have been wrong rather than merely unhelpful.
 *
 * `normalizes the shared vectors` is the same table as `NORMALIZATION_VECTORS` in
 * `packages/domain/tests/notification-silence.test.ts`. The rule is compiled in TypeScript and acted
 * on here; a comparison that drifts between the two would quiet a notification the reader never
 * described, so neither side gets to define it alone.
 */
class NotificationSilencePolicyTest {
  private val courier = "com.courier.app"
  private val ruleId = "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607"
  private val otherRuleId = "8f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f608"

  private fun test(field: String, operator: String, vararg values: String) =
    SilenceTest(field, operator, values.toList())

  private fun rule(
    action: String = NotificationSilencePolicy.ACTION_SNOOZE,
    filterRuleId: String = ruleId,
    observing: Boolean = false,
    awaitsModel: Boolean = false,
    unscoped: Boolean = false,
    vararg clauses: SilenceClause
  ) = SilenceRule(filterRuleId, action, observing, awaitsModel, unscoped, clauses.toList())

  private fun snapshot(
    mode: String = "enforcing",
    killSwitchEngaged: Boolean = false,
    disabledPackages: Set<String> = emptySet(),
    vararg rules: SilenceRule
  ) = SilenceSnapshot(mode, killSwitchEngaged, 1, rules.toList(), disabledPackages)

  private val courierClause =
    SilenceClause(listOf(test("source.applicationId", "equals", courier)))

  private val courierSnapshot = snapshot(rules = arrayOf(rule(clauses = arrayOf(courierClause))))

  private fun decide(
    snapshot: SilenceSnapshot,
    packageName: String = courier,
    subject: String? = null
  ) = NotificationSilencePolicy.decide(snapshot, packageName, "notification", subject)

  // Normalization ----------------------------------------------------------------------------------

  @Test
  fun `normalizes the shared vectors`() {
    val vectors = listOf(
      "Out For Delivery" to "out for delivery",
      "  out   for\tdelivery  " to "out for delivery",
      "OUT\u00a0FOR\u00a0DELIVERY" to "out for delivery",
      "out\u2009for\u2009delivery" to "out for delivery",
      "\ufb01nal notice" to "final notice",
      "\u2163 quarter" to "iv quarter",
      "caf\u00e9" to "caf\u00e9",
      "" to ""
    )
    for ((input, expected) in vectors) {
      assertEquals(expected, NotificationSilencePolicy.normalize(input))
    }
  }

  // Matching ---------------------------------------------------------------------------------------

  @Test
  fun `a rule naming the application silences it`() {
    assertEquals(SilenceDecision.SNOOZE, decide(courierSnapshot).decision)
  }

  @Test
  fun `the matched rule is named in the outcome`() {
    assertEquals(ruleId, decide(courierSnapshot).filterRuleId)
  }

  // A notification from an application no rule names is never evaluated and never recorded, so the
  // ledger cannot become a log of every app on the device.
  @Test
  fun `an application no rule names is ignored rather than recorded`() {
    assertEquals(SilenceDecision.IGNORED, decide(courierSnapshot, packageName = "com.unrelated.app").decision)
  }

  @Test
  fun `an application a rule names but whose notification misses is recorded as a miss`() {
    val narrowed = snapshot(
      rules = arrayOf(
        rule(
          clauses = arrayOf(
            SilenceClause(
              listOf(
                test("source.applicationId", "equals", courier),
                test("subject", "contains", "out for delivery")
              )
            )
          )
        )
      )
    )
    assertEquals(SilenceDecision.NO_MATCH, decide(narrowed, subject = "Parcel delayed").decision)
    assertEquals(
      SilenceDecision.SNOOZE,
      decide(narrowed, subject = "Your parcel is OUT FOR DELIVERY").decision
    )
  }

  // Android supplies no title for plenty of notifications, and absence must fail a comparison rather
  // than satisfy it, or a narrowing predicate would stop narrowing.
  @Test
  fun `an absent subject fails a subject comparison`() {
    val narrowed = snapshot(
      rules = arrayOf(
        rule(
          clauses = arrayOf(
            SilenceClause(
              listOf(
                test("source.applicationId", "equals", courier),
                test("subject", "contains", "delivery")
              )
            )
          )
        )
      )
    )
    assertEquals(SilenceDecision.NO_MATCH, decide(narrowed, subject = null).decision)
  }

  @Test
  fun `an in-predicate matches any of its values`() {
    val listed = snapshot(
      rules = arrayOf(
        rule(
          clauses = arrayOf(
            SilenceClause(listOf(test("source.applicationId", "in", courier, "com.other.app")))
          )
        )
      )
    )
    assertEquals(SilenceDecision.SNOOZE, decide(listed).decision)
    assertEquals(SilenceDecision.SNOOZE, decide(listed, packageName = "com.other.app").decision)
    assertEquals(SilenceDecision.IGNORED, decide(listed, packageName = "com.third.app").decision)
  }

  @Test
  fun `either clause of a disjunction can match`() {
    val either = snapshot(
      rules = arrayOf(
        rule(
          clauses = arrayOf(
            SilenceClause(
              listOf(
                test("source.applicationId", "equals", courier),
                test("subject", "contains", "delivered")
              )
            ),
            SilenceClause(
              listOf(
                test("source.applicationId", "equals", courier),
                test("subject", "starts-with", "promo")
              )
            )
          )
        )
      )
    )
    assertEquals(SilenceDecision.SNOOZE, decide(either, subject = "Parcel delivered").decision)
    assertEquals(SilenceDecision.SNOOZE, decide(either, subject = "Promo inside").decision)
    assertEquals(SilenceDecision.NO_MATCH, decide(either, subject = "Parcel delayed").decision)
  }

  // Actions ---------------------------------------------------------------------------------------

  @Test
  fun `a dismissing rule cancels rather than snoozes`() {
    val dismissing = snapshot(
      rules = arrayOf(
        rule(action = NotificationSilencePolicy.ACTION_DISMISS, clauses = arrayOf(courierClause))
      )
    )
    assertEquals(SilenceDecision.DISMISS, decide(dismissing).decision)
  }

  // One verdict per notification, decided by whichever rule comes first. Asking once per action
  // would record two verdicts under one capture identity and let the later overwrite the earlier.
  @Test
  fun `the first matching rule decides whatever its action`() {
    val both = snapshot(
      rules = arrayOf(
        rule(
          action = NotificationSilencePolicy.ACTION_DISMISS,
          filterRuleId = ruleId,
          clauses = arrayOf(courierClause)
        ),
        rule(
          action = NotificationSilencePolicy.ACTION_SNOOZE,
          filterRuleId = otherRuleId,
          clauses = arrayOf(courierClause)
        )
      )
    )
    val outcome = decide(both)
    assertEquals(SilenceDecision.DISMISS, outcome.decision)
    assertEquals(ruleId, outcome.filterRuleId)
  }

  @Test
  fun `a dry run observes a dismissal without cancelling`() {
    val observing = snapshot(
      mode = "dry-run",
      rules = arrayOf(
        rule(
          action = NotificationSilencePolicy.ACTION_DISMISS,
          observing = true,
          clauses = arrayOf(courierClause)
        )
      )
    )
    assertEquals(SilenceDecision.WOULD_DISMISS, decide(observing).decision)
  }

  // Modes and stops --------------------------------------------------------------------------------

  @Test
  fun `a dry run observes without acting`() {
    val observing = snapshot(
      mode = "dry-run",
      rules = arrayOf(rule(observing = true, clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.WOULD_SNOOZE, decide(observing).decision)
  }

  // One rule reaching the end of its window must not drag another out of its own. The snapshot mode
  // reports the overall state; the rule's flag is what decides.
  @Test
  fun `an observing rule and an authorized rule coexist`() {
    val mixed = snapshot(
      rules = arrayOf(
        rule(filterRuleId = ruleId, observing = true, clauses = arrayOf(courierClause)),
        rule(
          filterRuleId = otherRuleId,
          observing = false,
          clauses = arrayOf(
            SilenceClause(listOf(test("source.applicationId", "equals", "com.other.app")))
          )
        )
      )
    )
    assertEquals(SilenceDecision.WOULD_SNOOZE, decide(mixed).decision)
    assertEquals(SilenceDecision.SNOOZE, decide(mixed, packageName = "com.other.app").decision)
  }

  @Test
  fun `mode off evaluates nothing`() {
    val off = snapshot(mode = "off", rules = arrayOf(rule(clauses = arrayOf(courierClause))))
    assertEquals(SilenceDecision.IGNORED, decide(off).decision)
  }

  // A declined match is recorded rather than dropped. Without it, the kill switch is
  // indistinguishable from the rule having stopped matching.
  @Test
  fun `the kill switch declines a match and records it`() {
    val stopped = snapshot(
      killSwitchEngaged = true,
      rules = arrayOf(rule(clauses = arrayOf(courierClause)))
    )
    val outcome = decide(stopped)
    assertEquals(SilenceDecision.DECLINED, outcome.decision)
    assertEquals(ruleId, outcome.filterRuleId)
  }

  @Test
  fun `a disabled application declines a match`() {
    val paused = snapshot(
      disabledPackages = setOf(courier),
      rules = arrayOf(rule(clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.DECLINED, decide(paused).decision)
  }

  // A stop that failed to apply over a difference in case would fail in the direction that acts on
  // a notification, so the pause is compared the way a rule's application test is.
  @Test
  fun `a disabled application is matched the way a rule matches one`() {
    val paused = snapshot(
      disabledPackages = setOf("COM.Courier.App"),
      rules = arrayOf(rule(clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.DECLINED, decide(paused).decision)
  }

  @Test
  fun `the first matching rule decides`() {
    val both = snapshot(
      rules = arrayOf(
        rule(filterRuleId = ruleId, clauses = arrayOf(courierClause)),
        rule(filterRuleId = otherRuleId, clauses = arrayOf(courierClause))
      )
    )
    assertEquals(ruleId, decide(both).filterRuleId)
  }

  // Scope ------------------------------------------------------------------------------------------

  @Test
  fun `scope follows the applications rules name`() {
    assertTrue(NotificationSilencePolicy.inScope(courierSnapshot, courier))
    assertFalse(NotificationSilencePolicy.inScope(courierSnapshot, "com.unrelated.app"))
  }

  // A `contains` test describes an application rather than naming one, so it cannot put a
  // notification in scope on its own. The compiler refuses such a rule; this is the second line.
  @Test
  fun `a describing application test does not create scope`() {
    val describing = snapshot(
      rules = arrayOf(
        rule(
          clauses = arrayOf(
            SilenceClause(listOf(test("source.applicationId", "contains", "courier")))
          )
        )
      )
    )
    assertFalse(NotificationSilencePolicy.inScope(describing, courier))
  }

  // Waiting on a model ------------------------------------------------------------------------------

  private val awaiting =
    snapshot(rules = arrayOf(rule(awaitsModel = true, clauses = arrayOf(courierClause))))

  // The listener runs in a system-bound process with no session and cannot reach an endpoint. A rule
  // whose semantic clause is unanswered is a candidate, which is neither a match nor a miss.
  @Test
  fun `a rule owing a model an answer is recorded as a candidate`() {
    val outcome = decide(awaiting)
    assertEquals(SilenceDecision.AWAITING_MODEL, outcome.decision)
    assertEquals(ruleId, outcome.filterRuleId)
  }

  // An observing rule that also awaits a model is still only a candidate. Reporting `would-snooze`
  // here would put an unevaluated clause into the evidence that unlocks enforcement.
  @Test
  fun `an observing rule owing an answer is a candidate rather than an observation`() {
    val observing = snapshot(
      mode = "dry-run",
      rules = arrayOf(rule(observing = true, awaitsModel = true, clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.AWAITING_MODEL, decide(observing).decision)
  }

  // The stop comes first, so a stopped tenant never produces a candidate and no model is ever asked
  // about their notification.
  @Test
  fun `the kill switch declines before a candidate is created`() {
    val stopped = snapshot(
      killSwitchEngaged = true,
      rules = arrayOf(rule(awaitsModel = true, clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.DECLINED, decide(stopped).decision)
  }

  // A notification the literal tests reject never becomes a candidate, which is what bounds how many
  // requests a reader's own model receives: the rules they wrote select them, not the arrival rate.
  @Test
  fun `a literal miss is not a candidate`() {
    val narrowed = snapshot(
      rules = arrayOf(
        rule(
          awaitsModel = true,
          clauses = arrayOf(
            SilenceClause(
              listOf(
                test("source.applicationId", "equals", courier),
                test("subject", "contains", "delivered")
              )
            )
          )
        )
      )
    )
    assertEquals(SilenceDecision.NO_MATCH, decide(narrowed, subject = "Order placed").decision)
  }

  // Resolving a candidate ---------------------------------------------------------------------------

  private fun resolve(snapshot: SilenceSnapshot, matched: Boolean, packageName: String = courier) =
    NotificationSilencePolicy.resolve(snapshot, packageName, ruleId, matched)

  @Test
  fun `a model answering yes authorizes the rules own action`() {
    val outcome = resolve(awaiting, matched = true)
    assertEquals(SilenceDecision.SNOOZE, outcome.decision)
    assertEquals(ruleId, outcome.filterRuleId)
  }

  @Test
  fun `a model answering no is recorded as a miss`() {
    val outcome = resolve(awaiting, matched = false)
    assertEquals(SilenceDecision.NO_MATCH, outcome.decision)
    assertEquals(ruleId, outcome.filterRuleId)
  }

  // The whole point of re-reading the snapshot. Asking a model takes time, and a reader who stopped
  // Relay inside that time is obeyed rather than raced.
  @Test
  fun `a stop engaged while a model was thinking declines the answer`() {
    val stopped = snapshot(
      killSwitchEngaged = true,
      rules = arrayOf(rule(awaitsModel = true, clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.DECLINED, resolve(stopped, matched = true).decision)
  }

  @Test
  fun `an application paused while a model was thinking declines the answer`() {
    val paused = snapshot(
      disabledPackages = setOf(courier),
      rules = arrayOf(rule(awaitsModel = true, clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.DECLINED, resolve(paused, matched = true).decision)
  }

  // A rule the reader deleted, or one replaced by a new revision under a new id, cannot act on an
  // answer that was sought on its behalf.
  @Test
  fun `an answer for a rule that no longer exists declines`() {
    val replaced = snapshot(
      rules = arrayOf(rule(filterRuleId = otherRuleId, clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.DECLINED, resolve(replaced, matched = true).decision)
  }

  @Test
  fun `an observing rule records what it would have done`() {
    val observing = snapshot(
      mode = "dry-run",
      rules = arrayOf(
        rule(
          action = NotificationSilencePolicy.ACTION_DISMISS,
          observing = true,
          awaitsModel = true,
          clauses = arrayOf(courierClause)
        )
      )
    )
    assertEquals(SilenceDecision.WOULD_DISMISS, resolve(observing, matched = true).decision)
  }

  // A miss is reported as a miss even under a stop, exactly as `decide` reports a miss before it
  // reports a refusal: a rule that did not match was not refused.
  @Test
  fun `a stop does not turn a miss into a refusal`() {
    val stopped = snapshot(
      killSwitchEngaged = true,
      rules = arrayOf(rule(awaitsModel = true, clauses = arrayOf(courierClause)))
    )
    assertEquals(SilenceDecision.NO_MATCH, resolve(stopped, matched = false).decision)
  }

  // Unscoped rules -----------------------------------------------------------------------------

  private val unscopedSnapshot =
    snapshot(rules = arrayOf(rule(awaitsModel = true, unscoped = true)))

  // A rule with no literal tests has nothing to satisfy, so every notification already in scope is
  // a candidate and the model decides each one (ADR-0020).
  @Test
  fun `an unscoped rule makes every notification a candidate`() {
    assertEquals(SilenceDecision.AWAITING_MODEL, decide(unscopedSnapshot).decision)
    assertEquals(
      SilenceDecision.AWAITING_MODEL,
      decide(unscopedSnapshot, packageName = "com.unrelated.app").decision
    )
  }

  // Scope is what the ledger records. An unscoped rule covers everything the capture allowlist
  // already admits -- which is the cost of the feature, and is why the row says so.
  @Test
  fun `an unscoped rule puts every application in scope`() {
    assertTrue(NotificationSilencePolicy.inScope(unscopedSnapshot, courier))
    assertTrue(NotificationSilencePolicy.inScope(unscopedSnapshot, "com.unrelated.app"))
  }

  @Test
  fun `a stop still outranks an unscoped rule`() {
    val stopped = snapshot(
      killSwitchEngaged = true,
      rules = arrayOf(rule(awaitsModel = true, unscoped = true))
    )
    assertEquals(SilenceDecision.DECLINED, decide(stopped).decision)
  }

  // Once the model answers, an unscoped rule resolves like any other.
  @Test
  fun `an unscoped rule acts on a model answering yes`() {
    assertEquals(SilenceDecision.SNOOZE, resolve(unscopedSnapshot, matched = true).decision)
    assertEquals(SilenceDecision.NO_MATCH, resolve(unscopedSnapshot, matched = false).decision)
  }
}
