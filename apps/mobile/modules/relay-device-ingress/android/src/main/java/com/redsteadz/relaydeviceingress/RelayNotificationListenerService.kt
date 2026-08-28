package com.redsteadz.relaydeviceingress

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class RelayNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(notification: StatusBarNotification) {
    synchronized(NotificationCaptureStateLock) {
      val settings = NotificationCaptureSettings(applicationContext)
      if (!settings.listenerAccessGranted()) return
      val configuration = settings.read() ?: return
      if (configuration.paused) return
      if (notification.packageName == packageName) return
      if (notification.packageName !in configuration.allowedPackages) return

      val capture = NotificationEnvelopeFactory.create(notification, System.currentTimeMillis())
      CaptureQueueStore(applicationContext).use { queue ->
        queue.enqueue(configuration.tenantId, capture.envelopeId, capture.capturedAt, capture.json)
      }
    }
  }
}
