package com.redsteadz.relaydeviceingress

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class RelayNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(notification: StatusBarNotification) {
    // Capture and upload are intentionally deferred until consent, local encryption,
    // offline retry, and explicit dismissal safeguards are implemented together.
  }
}
