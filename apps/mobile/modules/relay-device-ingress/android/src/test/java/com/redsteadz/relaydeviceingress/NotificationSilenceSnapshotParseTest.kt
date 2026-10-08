package com.redsteadz.relaydeviceingress

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reading the authorization the app wrote.
 *
 * This parser is the last gate before an irreversible act, and it is deliberately the least
 * forgiving code in the module. Every case below is a snapshot that is wrong in some way, and in
 * every one the right answer is to hold no authorization at all rather than to honour the part that
 * parsed. The app rewrites the snapshot whenever it changes, so refusing one costs a notification
 * that keeps ringing -- the recoverable direction.
 */
class NotificationSilenceSnapshotParseTest {
  private val courier = "com.courier.app"
  private val ruleId = "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607"

  private fun snapshotJson(
    mode: String = "enforcing",
    killSwitchEngaged: Boolean = false,
    rules: String = """[{"action":"snooze","filterRuleId":"$ruleId","observing":false,"awaitsModel":false,"clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["$courier"]}]}]}]""",
    disabledPackages: String = "[]"
  ) = """
    {"mode":"$mode","killSwitchEngaged":$killSwitchEngaged,"revision":7,
     "rules":$rules,"disabledPackages":$disabledPackages}
  """.trimIndent()

  @Test
  fun `a well-formed snapshot parses`() {
    val snapshot = NotificationSilencePolicy.parse(snapshotJson())
    assertEquals("enforcing", snapshot.mode)
    assertEquals(7L, snapshot.revision)
    assertEquals(1, snapshot.rules.size)
    assertEquals(ruleId, snapshot.rules[0].filterRuleId)
    assertEquals(NotificationSilencePolicy.ACTION_SNOOZE, snapshot.rules[0].action)
    assertEquals(false, snapshot.rules[0].observing)
    assertEquals(false, snapshot.rules[0].awaitsModel)
    assertEquals(1, snapshot.rules[0].clauses[0].tests.size)
  }

  // A rule that does not say whether it is still being observed is observed. A missing flag must
  // never read as permission to act on a notification.
  @Test
  fun `a rule omitting its observing flag observes`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["$courier"]}]}]}]"""
      )
    )
    assertEquals(1, snapshot.rules.size)
    assertTrue(snapshot.rules[0].observing)
  }

  // Same fail-safe, for the flag an older snapshot cannot carry: a rule this version cannot fully
  // read is treated as owing a model an answer, so it records a candidate rather than acting.
  @Test
  fun `a rule omitting its model flag owes an answer`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[{"action":"snooze","filterRuleId":"$ruleId","observing":false,"clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["$courier"]}]}]}]"""
      )
    )
    assertEquals(1, snapshot.rules.size)
    assertTrue(snapshot.rules[0].awaitsModel)
  }

  @Test
  fun `a disabled application list parses`() {
    val snapshot = NotificationSilencePolicy.parse(snapshotJson(disabledPackages = """["$courier"]"""))
    assertEquals(setOf(courier), snapshot.disabledPackages)
  }

  @Test
  fun `an absent snapshot authorizes nothing`() {
    assertEquals(SilenceSnapshot.OFF, NotificationSilencePolicy.parse(null))
    assertEquals(SilenceSnapshot.OFF, NotificationSilencePolicy.parse(""))
  }

  @Test
  fun `malformed json authorizes nothing`() {
    assertEquals(SilenceSnapshot.OFF, NotificationSilencePolicy.parse("{not json"))
  }

  @Test
  fun `an unrecognised mode authorizes nothing`() {
    assertEquals(SilenceSnapshot.OFF, NotificationSilencePolicy.parse(snapshotJson(mode = "always")))
  }

  // A snapshot that omits the field is treated as stopped, not as running. A missing stop must never
  // read as permission.
  @Test
  fun `an absent kill switch reads as engaged`() {
    val snapshot = NotificationSilencePolicy.parse(
      """{"mode":"enforcing","revision":1,"rules":[],"disabledPackages":[]}"""
    )
    assertTrue(snapshot.killSwitchEngaged)
  }

  // A clause whose application test only describes the application would let an unrelated app
  // satisfy it. Dropping the rule is the only safe reading.
  @Test
  fun `a clause naming no application is refused`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"subject","operator":"contains","values":["delivery"]}]}]}]"""
      )
    )
    assertTrue(snapshot.rules.isEmpty())
  }

  @Test
  fun `a clause describing rather than naming an application is refused`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"contains","values":["courier"]}]}]}]"""
      )
    )
    assertTrue(snapshot.rules.isEmpty())
  }

  // A field this surface cannot read drops the rule rather than the test. Dropping the test alone
  // would remove a predicate the reader wrote to narrow the rule, so it would act more widely than
  // authorized.
  @Test
  fun `a test on an unreadable field discards the whole rule`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["$courier"]},{"field":"category","operator":"equals","values":["finance"]}]}]}]"""
      )
    )
    assertTrue(snapshot.rules.isEmpty())
  }

  @Test
  fun `an unrecognised operator discards the whole rule`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"matches","values":["$courier"]}]}]}]"""
      )
    )
    assertTrue(snapshot.rules.isEmpty())
  }

  @Test
  fun `an unrecognised action discards the whole rule`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[{"action":"delete","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["$courier"]}]}]}]"""
      )
    )
    assertTrue(snapshot.rules.isEmpty())
  }

  // One unreadable rule discards the list, because a partial list is a different authorization than
  // the one the tenant granted.
  @Test
  fun `one unreadable rule discards every rule`() {
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(
        rules = """[
          {"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["$courier"]}]}]},
          {"action":"snooze","filterRuleId":"","clauses":[]}
        ]"""
      )
    )
    assertTrue(snapshot.rules.isEmpty())
  }

  @Test
  fun `a test whose value count does not match its operator is refused`() {
    for (rules in listOf(
      """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":[]}]}]}]""",
      """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["a","b"]}]}]}]""",
      """[{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"in","values":[]}]}]}]"""
    )) {
      assertTrue(NotificationSilencePolicy.parse(snapshotJson(rules = rules)).rules.isEmpty())
    }
  }

  @Test
  fun `more rules than the bound authorizes nothing`() {
    val rule =
      """{"action":"snooze","filterRuleId":"$ruleId","clauses":[{"tests":[{"field":"source.applicationId","operator":"equals","values":["$courier"]}]}]}"""
    val snapshot = NotificationSilencePolicy.parse(
      snapshotJson(rules = "[${List(33) { rule }.joinToString(",")}]")
    )
    assertTrue(snapshot.rules.isEmpty())
  }
}
