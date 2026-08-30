package com.redsteadz.relaydeviceingress

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class RelayNotificationListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    NotificationDebugDiagnostics.event("listener connected")
  }

  override fun onListenerDisconnected() {
    NotificationDebugDiagnostics.event("listener disconnected")
  }

  override fun onNotificationPosted(notification: StatusBarNotification) {
    synchronized(NotificationCaptureStateLock) {
      NotificationDebugDiagnostics.event("notification posted package=${notification.packageName}")
      val settings = NotificationCaptureSettings(applicationContext)
      val accessGranted = settings.listenerAccessGranted()
      NotificationDebugDiagnostics.event("listener access granted=$accessGranted")
      if (!accessGranted) return
      val configuration = settings.read()
      NotificationDebugDiagnostics.event("configuration found=${configuration != null}")
      if (configuration == null) return
      NotificationDebugDiagnostics.event(
        "capture paused=${configuration.paused} allowlistSize=${configuration.allowedPackages.size}"
      )
      if (configuration.paused) return
      if (notification.packageName == packageName) {
        NotificationDebugDiagnostics.event("skipped relay's own notification")
        return
      }
      val allowed = notification.packageName in configuration.allowedPackages
      NotificationDebugDiagnostics.event(
        "package allowed=$allowed package=${notification.packageName}"
      )
      if (!allowed) return

      try {
        val capture = NotificationEnvelopeFactory.create(notification, System.currentTimeMillis())
        CaptureQueueStore(applicationContext).use { queue ->
          queue.enqueue(
            configuration.tenantId,
            capture.envelopeId,
            "notification",
            capture.capturedAt,
            capture.json
          )
        }
        NotificationDebugDiagnostics.event("capture enqueued")
      } catch (error: RuntimeException) {
        NotificationDebugDiagnostics.failure("capture enqueue threw an exception", error)
      }
    }
  }
}
