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
    vararg clauses: SilenceClause
  ) = SilenceRule(filterRuleId, action, observing, clauses.toList())

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
}
