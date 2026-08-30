package com.redsteadz.relaydeviceingress

import android.content.Context
import android.telephony.TelephonyManager
import java.util.Locale

internal object SmsCountryIso {
  fun resolve(context: Context): String {
    val telephony = context.getSystemService(TelephonyManager::class.java)
    val telephonyCountries = try {
      listOf(telephony?.simCountryIso, telephony?.networkCountryIso)
    } catch (_: RuntimeException) {
      emptyList()
    }
    return (telephonyCountries + context.resources.configuration.locales[0].country)
      .firstOrNull { !it.isNullOrBlank() }
      .orEmpty()
      .uppercase(Locale.ROOT)
  }
}
