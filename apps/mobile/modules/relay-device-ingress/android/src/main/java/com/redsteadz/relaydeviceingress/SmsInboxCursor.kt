package com.redsteadz.relaydeviceingress

import android.provider.BaseColumns

internal data class SmsInboxQuery(
  val selection: String?,
  val selectionArgs: Array<String>?,
  val sortOrder: String
)

internal object SmsInboxCursor {
  fun query(lastProviderId: Long): SmsInboxQuery = if (lastProviderId == 0L) {
    SmsInboxQuery(null, null, "${BaseColumns._ID} ASC")
  } else {
    SmsInboxQuery(
      "${BaseColumns._ID}>?",
      arrayOf(lastProviderId.toString()),
      "${BaseColumns._ID} ASC"
    )
  }

  fun afterRow(lastProviderId: Long, providerId: Long, completed: Boolean): Long =
    if (completed) maxOf(lastProviderId, providerId) else lastProviderId

  fun afterAllowlistUpdate(
    currentTenantId: String?,
    currentAllowedSenders: Set<String>,
    nextTenantId: String,
    nextAllowedSenders: Set<String>,
    lastProviderId: Long
  ): Long = if (
    currentTenantId == nextTenantId && currentAllowedSenders == nextAllowedSenders
  ) {
    lastProviderId
  } else {
    0
  }
}
