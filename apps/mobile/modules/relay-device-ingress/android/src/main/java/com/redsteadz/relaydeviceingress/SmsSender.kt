package com.redsteadz.relaydeviceingress

import java.util.Locale

internal object SmsSender {
  private val phoneLike = Regex("^\\+?[0-9\\s().-]+$")
  private val phoneSeparators = Regex("[\\s().-]")
  private val pakistanLocalMobile = Regex("^03[0-9]{9}$")
  private val pakistanCountryMobile = Regex("^923[0-9]{9}$")

  /**
   * Produces one exact comparison key. Country-aware rewriting is deliberately limited to known
   * representations of the same Pakistani mobile number; all other values remain exact after
   * separators/case are normalized.
   */
  fun normalize(sender: String, defaultCountryIso: String? = null): String {
    val trimmed = sender.trim()
    if (!phoneLike.matches(trimmed)) return trimmed.lowercase(Locale.ROOT)

    val compact = trimmed.replace(phoneSeparators, "")
    val international = if (compact.startsWith("00") && compact.length > 2) {
      "+${compact.drop(2)}"
    } else {
      compact
    }
    if (international.startsWith("+")) return international
    if (defaultCountryIso?.uppercase(Locale.ROOT) != "PK") return international

    return when {
      pakistanLocalMobile.matches(international) -> "+92${international.drop(1)}"
      pakistanCountryMobile.matches(international) -> "+$international"
      else -> international
    }
  }
}
