package com.redsteadz.relaydeviceingress

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RelayDeviceIngressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RelayDeviceIngress")

    AsyncFunction("getCapabilities") {
      val context = requireNotNull(appContext.reactContext)
      val listeners = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners"
      ).orEmpty()
      val smsGranted = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.READ_SMS
      ) == PackageManager.PERMISSION_GRANTED

      mapOf(
        "notificationListener" to listeners.contains(context.packageName),
        "smsRead" to smsGranted,
        "platform" to "android"
      )
    }

    AsyncFunction("openNotificationAccessSettings") {
      val activity = requireNotNull(appContext.currentActivity)
      activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }
  }
}
