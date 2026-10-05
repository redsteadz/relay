package com.redsteadz.relaydeviceingress

import java.text.Normalizer
import java.util.Locale
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** What Relay decided about one posted notification. */
internal enum class SilenceDecision {
  /** No rule names this application, or quieting is off. Nothing is evaluated and nothing recorded. */
  IGNORED,
  /** A rule names the application but the notification did not satisfy it. Recorded as a miss. */
  NO_MATCH,
  /** A rule matched during the observation window. Nothing was done to the notification. */
  WOULD_SNOOZE,
  WOULD_DISMISS,
  /** A rule matched and Relay acted. */
  SNOOZE,
  DISMISS,
  /** A rule matched and Relay deliberately did not act. */
  DECLINED;

  /** The wire vocabulary in `notificationSilenceDecisionSchema`. */
  fun wireName(): String = when (this) {
    IGNORED -> "ignored"
    NO_MATCH -> "no-match"
    WOULD_SNOOZE -> "would-snooze"
    WOULD_DISMISS -> "would-dismiss"
    SNOOZE -> "snoozed"
    DISMISS -> "dismissed"
    DECLINED -> "declined"
  }
}

internal data class SilenceOutcome(
  val decision: SilenceDecision,
  val filterRuleId: String? = null
)

internal data class SilenceTest(
  val field: String,
  val operator: String,
  val values: List<String>
)

internal data class SilenceClause(val tests: List<SilenceTest>)

internal data class SilenceRule(
  val filterRuleId: String,
  val action: String,
  /** Still being observed rather than acted on. Per rule, because dry runs do not end together. */
  val observing: Boolean,
  val clauses: List<SilenceClause>
)

internal data class SilenceSnapshot(
  val mode: String,
  val killSwitchEngaged: Boolean,
  val revision: Long,
  val rules: List<SilenceRule>,
  val disabledPackages: Set<String>
) {
  companion object {
    /** No authorization at all, and maximally stopped: what every unreadable snapshot becomes. */
    val OFF = SilenceSnapshot("off", true, 0, emptyList(), emptySet())
  }
}

/**
 * Whether a posted notification is one the tenant authorized Relay to clear, and how.
 *
 * Kept pure and separate from the listener for the same reason `NotificationCapturePolicy` is: it is
 * the part worth testing, which it cannot be while it needs a bound service and a live notification.
 *
 * The clause grammar it evaluates is produced by `compileNotificationSilenceRule` in
 * `@relay/domain`, which refuses anything this cannot evaluate faithfully: negation, a field that is
 * not available when the decision is made, a rule naming no application. Nothing is approximated
 * here -- an unrecognised operator or field drops the whole rule rather than the one test, because a
 * rule missing a narrowing predicate would act on more than it was authorized to.
 */
internal object NotificationSilencePolicy {
  /**
   * The characters JavaScript's `\s` matches.
   *
   * Java's `\s` is ASCII-only and `String.trim` does not treat a non-breaking space as whitespace,
   * so neither matches `normalizeSilenceText`. Collapsing this class to a single space and then
   * trimming that space is exact: the JS implementation trims before collapsing, which yields the
   * same string either way.
   */
  private val JS_WHITESPACE =
    Regex("[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+")

  private val READABLE_FIELDS = setOf("source.applicationId", "source.kind", "subject")
  private val OPERATORS = setOf("equals", "contains", "starts-with", "in", "exists")

  private const val MAX_RULES = 32
  private const val MAX_CLAUSES = 16
  private const val MAX_TESTS = 16
  private const val MAX_VALUES = 32
  private const val MAX_VALUE_LENGTH = 1024

  /**
   * Canonical text comparison, identical to `normalizeSilenceText` in `@relay/domain`.
   *
   * `NotificationSilencePolicyTest` and `notification-silence.test.ts` assert the same vectors.
   * Normalization drifting between the runtime that compiles a rule and the runtime that acts on it
   * would quiet a notification the reader never described.
   */
  fun normalize(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFKC)
      .replace(JS_WHITESPACE, " ")
      .trim(' ')
      .lowercase(Locale.US)

  /**
   * Reads a snapshot the app wrote.
   *
   * Defensive to the point of discarding: a snapshot that does not parse, or a rule carrying
   * anything this version does not understand, yields no authorization at all. The app rewrites the
   * snapshot whenever it changes, so refusing a malformed one costs a quiet notification rather than
   * an incorrect cancellation.
   */
  fun parse(json: String?): SilenceSnapshot {
    if (json.isNullOrBlank()) return SilenceSnapshot.OFF
    return try {
      val root = JSONObject(json)
      val mode = root.optString("mode", "off")
      if (mode != "off" && mode != "dry-run" && mode != "enforcing") return SilenceSnapshot.OFF
      SilenceSnapshot(
        mode = mode,
        killSwitchEngaged = root.optBoolean("killSwitchEngaged", true),
        revision = root.optLong("revision", 0),
        rules = parseRules(root.optJSONArray("rules")),
        disabledPackages = parseStrings(root.optJSONArray("disabledPackages")).toSet()
      )
    } catch (_: JSONException) {
      SilenceSnapshot.OFF
    }
  }

  private fun parseRules(array: JSONArray?): List<SilenceRule> {
    if (array == null || array.length() > MAX_RULES) return emptyList()
    val rules = mutableListOf<SilenceRule>()
    for (index in 0 until array.length()) {
      val rule = parseRule(array.optJSONObject(index)) ?: return emptyList()
      rules += rule
    }
    return rules
  }

  /** One unreadable rule discards the whole snapshot: a partial list is a different authorization. */
  private fun parseRule(json: JSONObject?): SilenceRule? {
    if (json == null) return null
    val filterRuleId = json.optString("filterRuleId").takeIf { it.isNotBlank() } ?: return null
    val action = json.optString("action")
    if (action != ACTION_SNOOZE && action != ACTION_DISMISS) return null
    val clausesJson = json.optJSONArray("clauses") ?: return null
    if (clausesJson.length() == 0 || clausesJson.length() > MAX_CLAUSES) return null
    // A rule that does not say observes. A missing flag must never read as permission to act.
    val observing = json.optBoolean("observing", true)

    val clauses = mutableListOf<SilenceClause>()
    for (index in 0 until clausesJson.length()) {
      val clause = parseClause(clausesJson.optJSONObject(index)) ?: return null
      clauses += clause
    }
    return SilenceRule(filterRuleId, action, observing, clauses)
  }

  private fun parseClause(json: JSONObject?): SilenceClause? {
    val testsJson = json?.optJSONArray("tests") ?: return null
    if (testsJson.length() == 0 || testsJson.length() > MAX_TESTS) return null

    val tests = mutableListOf<SilenceTest>()
    for (index in 0 until testsJson.length()) {
      val test = parseTest(testsJson.optJSONObject(index)) ?: return null
      tests += test
    }
    // The clause must name an application, not merely describe one. `compileNotificationSilenceRule`
    // guarantees this and the database routine guarantees it of the stored plan; re-checking it here
    // means a snapshot written by anything else cannot widen what Relay acts on.
    val names = tests.any { test ->
      test.field == "source.applicationId" && (test.operator == "equals" || test.operator == "in")
    }
    return if (names) SilenceClause(tests) else null
  }

  private fun parseTest(json: JSONObject?): SilenceTest? {
    if (json == null) return null
    val field = json.optString("field")
    val operator = json.optString("operator")
    if (field !in READABLE_FIELDS || operator !in OPERATORS) return null
    val values = parseStrings(json.optJSONArray("values"))
    val expected = when (operator) {
      "exists" -> values.isEmpty()
      "in" -> values.isNotEmpty()
      else -> values.size == 1
    }
    return if (expected) SilenceTest(field, operator, values) else null
  }

  private fun parseStrings(array: JSONArray?): List<String> {
    if (array == null || array.length() > MAX_VALUES) return emptyList()
    val values = mutableListOf<String>()
    for (index in 0 until array.length()) {
      val value = array.opt(index) as? String ?: return emptyList()
      if (value.isEmpty() || value.length > MAX_VALUE_LENGTH) return emptyList()
      values += value
    }
    return values
  }

  /**
   * What a rule may do.
   *
   * `snooze` removes the notification for a while and Android brings it back; `dismiss` cancels it
   * and nothing brings it back. Both happen after the phone has already alerted -- see
   * `RelayNotificationListenerService`.
   */
  const val ACTION_SNOOZE = "snooze"
  const val ACTION_DISMISS = "dismiss"

  /**
   * Whether any rule names this application.
   *
   * This is the privacy scope of the ledger, not an optimization. A notification no rule names is
   * never evaluated and never recorded, so the dry-run history cannot become a log of every app a
   * person uses.
   */
  fun inScope(snapshot: SilenceSnapshot, packageName: String): Boolean {
    if (snapshot.mode == "off") return false
    val normalized = normalize(packageName)
    return snapshot.rules.any { rule ->
      rule.clauses.any { clause ->
        clause.tests.any { test ->
          test.field == "source.applicationId" &&
            (test.operator == "equals" || test.operator == "in") &&
            test.values.any { value -> normalize(value) == normalized }
        }
      }
    }
  }

  /**
   * What to do about one notification.
   *
   * The first matching rule decides, in the snapshot's own order, whatever its action. That mirrors
   * how a capture is filed -- one rule claims it -- and it means a notification matched by both a
   * snoozing rule and a dismissing rule gets one verdict rather than two. The alternative, asking
   * per action, would record two verdicts under one capture identity and let the later overwrite the
   * earlier.
   *
   * `subject` is Android's notification title, the only text this reads. Absence fails a comparison
   * rather than satisfying it, which is what keeps a narrowing predicate narrowing: Android supplies
   * no title for plenty of notifications.
   */
  fun decide(
    snapshot: SilenceSnapshot,
    packageName: String,
    sourceKind: String,
    subject: String?
  ): SilenceOutcome {
    if (!inScope(snapshot, packageName)) return SilenceOutcome(SilenceDecision.IGNORED)

    val matched = snapshot.rules.firstOrNull { rule ->
      rule.clauses.any { clause ->
        clause.tests.all { test -> passes(test, packageName, sourceKind, subject) }
      }
    } ?: return SilenceOutcome(SilenceDecision.NO_MATCH)

    // A matched rule the device will not act on is still recorded. Without it, the kill switch and a
    // per-application pause are indistinguishable from the rule having stopped matching.
    //
    // The pause is compared the same way a rule's application test is, because a stop that failed to
    // apply over a difference in case would fail in the direction that acts on a notification.
    val paused = snapshot.disabledPackages.any { value -> normalize(value) == normalize(packageName) }
    if (snapshot.killSwitchEngaged || paused) {
      return SilenceOutcome(SilenceDecision.DECLINED, matched.filterRuleId)
    }

    // The rule's own flag, not the snapshot's mode: one rule can be authorized while another is
    // still inside its observation window.
    val decision = when {
      matched.action == ACTION_SNOOZE && matched.observing -> SilenceDecision.WOULD_SNOOZE
      matched.action == ACTION_SNOOZE -> SilenceDecision.SNOOZE
      matched.observing -> SilenceDecision.WOULD_DISMISS
      else -> SilenceDecision.DISMISS
    }
    return SilenceOutcome(decision, matched.filterRuleId)
  }

  private fun passes(
    test: SilenceTest,
    packageName: String,
    sourceKind: String,
    subject: String?
  ): Boolean {
    val raw = when (test.field) {
      "source.applicationId" -> packageName
      "source.kind" -> sourceKind
      else -> subject
    }
    if (test.operator == "exists") return !raw.isNullOrEmpty()
    if (raw == null) return false

    val actual = normalize(raw)
    if (test.operator == "in") return test.values.any { value -> normalize(value) == actual }
    val expected = normalize(test.values.firstOrNull().orEmpty())
    return when (test.operator) {
      "equals" -> actual == expected
      "contains" -> actual.contains(expected)
      else -> actual.startsWith(expected)
    }
  }
}
