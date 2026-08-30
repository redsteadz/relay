package com.redsteadz.relaydeviceingress

import android.util.Log

internal object NotificationDebugDiagnostics {
  private const val TAG = "RelayNotificationCapture"

  fun event(message: String) {
    if (BuildConfig.DEBUG) Log.d(TAG, message)
  }

  fun failure(message: String, error: Throwable? = null) {
    if (BuildConfig.DEBUG) Log.w(TAG, message, error)
  }
}
