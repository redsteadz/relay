package com.redsteadz.relaydeviceingress

import android.app.Notification
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
      // A grouped app must post a summary alongside its children. The summary only aggregates
      // content the children already carry, and it is rewritten on every new child, so capturing it
      // duplicates observations and churns identity for no added signal.
      if (notification.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) {
        NotificationDebugDiagnostics.event("skipped group summary")
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
          // Kept separately from the outbox so acknowledging an upload does not also remove the
          // tenant's own ability to read what was captured.
          queue.retainContent(
            configuration.tenantId,
            capture.envelopeId,
            capture.capturedAt,
            capture.content
          )
        }
        NotificationDebugDiagnostics.event("capture enqueued")
      } catch (error: RuntimeException) {
        NotificationDebugDiagnostics.failure("capture enqueue threw an exception", error)
      }
    }
  }
}
