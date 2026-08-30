package com.redsteadz.relaydeviceingress

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.provider.ContactsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract

internal class PickPhoneNumberContract : AppContextActivityResultContract<String, String?> {
  override fun createIntent(context: Context, input: String): Intent =
    Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI)

  override fun parseResult(input: String, resultCode: Int, intent: Intent?): String? =
    intent?.data?.toString().takeIf { resultCode == Activity.RESULT_OK }
}
