package com.redsteadz.relaydeviceingress

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class RelayNotificationListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    NotificationDebugDiagnostics.event("listener connected")
    captureAlreadyPosted()
  }

  override fun onListenerDisconnected() {
    NotificationDebugDiagnostics.event("listener disconnected")
  }

  override fun onNotificationPosted(notification: StatusBarNotification) {
    synchronized(NotificationCaptureStateLock) {
      NotificationDebugDiagnostics.event("notification posted package=${notification.packageName}")
      val configuration = enabledConfiguration() ?: return
      if (!capturable(notification, configuration)) return
      try {
        CaptureQueueStore(applicationContext).use { queue ->
          capture(queue, configuration.tenantId, notification)
        }
        NotificationDebugDiagnostics.event("capture enqueued")
      } catch (error: RuntimeException) {
        NotificationDebugDiagnostics.failure("capture enqueue threw an exception", error)
      }
    }
  }

  /**
   * Captures what was already on screen when this listener connected.
   *
   * `onNotificationPosted` fires only for a notification posted while the listener is bound, and
   * nothing else reads the shade. A notification that arrived while the listener was unbound -- an
   * app update, a reboot, process death, the system rebinding the service -- was therefore lost
   * permanently while still sitting visible on the device. An unbind should cost a delay, not the
   * capture.
   *
   * Re-offering a capture is safe by construction rather than by luck. The envelope UUID is derived
   * from the posting package, Android's notification key, and a fingerprint of the visible content,
   * so an unchanged notification produces the identity it produced before: the queue keeps the
   * original row and its retry history, and the pipeline recognises a redelivery instead of storing
   * a second capture.
   *
   * The gates are the live path's gates, applied by the same functions. A sweep that decided for
   * itself what to capture would be a second capture policy to keep in step with the first.
   */
  private fun captureAlreadyPosted() {
    synchronized(NotificationCaptureStateLock) {
      // Being called is the system's own statement that access was granted -- it does not bind a
      // listener it has not authorized -- so this path does not re-read the setting. Reading it did
      // not merely duplicate the guarantee, it broke the sweep exactly where it matters most: on a
      // fresh grant the binding arrives before `Settings.Secure` reflects it, so the sweep declined
      // for want of a permission it was holding, and the shade a person had just given Relay access
      // to went uncaptured.
      val configuration = captureConfiguration() ?: return
      // Android refuses this until the binding it has just announced is fully established. A
      // listener that cannot yet read the shade has nothing to sweep, which is a state to record
      // rather than a failure to report: the next connection sweeps.
      val active =
        try {
          activeNotifications
        } catch (error: RuntimeException) {
          NotificationDebugDiagnostics.failure("active notifications unavailable", error)
          return
        } ?: return

      var captured = 0
      try {
        CaptureQueueStore(applicationContext).use { queue ->
          // Oldest first, so a sweep enqueues in the order the notifications arrived rather than in
          // whatever order Android happens to return them.
          for (notification in active.sortedBy { it.postTime }) {
            if (!capturable(notification, configuration)) continue
            if (capture(queue, configuration.tenantId, notification, skipRecorded = true)) {
              captured += 1
            }
          }
        }
      } catch (error: RuntimeException) {
        NotificationDebugDiagnostics.failure("active notification sweep threw an exception", error)
      }
      NotificationDebugDiagnostics.event(
        "swept already-posted notifications found=${active.size} captured=$captured"
      )
    }
  }

  /**
   * The capture configuration when capture is enabled and the tenant still grants access.
   *
   * Every reason to decline is reported, because a capture that silently does not happen is the
   * failure this service is hardest to diagnose from the outside.
   */
  private fun enabledConfiguration(): NotificationCaptureConfiguration? {
    val accessGranted = NotificationCaptureSettings(applicationContext).listenerAccessGranted()
    NotificationDebugDiagnostics.event("listener access granted=$accessGranted")
    return if (accessGranted) captureConfiguration() else null
  }

  /** What the tenant asked Relay to capture, when capture is on. */
  private fun captureConfiguration(): NotificationCaptureConfiguration? {
    val configuration = NotificationCaptureSettings(applicationContext).read()
    NotificationDebugDiagnostics.event("configuration found=${configuration != null}")
    if (configuration == null) return null
    NotificationDebugDiagnostics.event(
      "capture paused=${configuration.paused} allowlistSize=${configuration.allowedPackages.size}"
    )
    return if (configuration.paused) null else configuration
  }

  /**
   * Whether this notification is one the tenant asked Relay to capture.
   *
   * The decision itself is `NotificationCapturePolicy`, shared with every route a notification can
   * take into Relay. What belongs here is only reporting it.
   */
  private fun capturable(
    notification: StatusBarNotification,
    configuration: NotificationCaptureConfiguration
  ): Boolean {
    val decision =
      NotificationCapturePolicy.decide(
        notification.packageName,
        packageName,
        notification.notification.flags,
        configuration.allowedPackages
      )
    when (decision) {
      NotificationCaptureDecision.OWN_NOTIFICATION ->
        NotificationDebugDiagnostics.event("skipped relay's own notification")
      NotificationCaptureDecision.GROUP_SUMMARY ->
        NotificationDebugDiagnostics.event("skipped group summary")
      NotificationCaptureDecision.PACKAGE_NOT_ALLOWED,
      NotificationCaptureDecision.CAPTURE ->
        NotificationDebugDiagnostics.event(
          "package allowed=${decision == NotificationCaptureDecision.CAPTURE}" +
            " package=${notification.packageName}"
        )
    }
    return decision == NotificationCaptureDecision.CAPTURE
  }

  /**
   * Enqueues one capture and keeps the tenant's own copy of what it said.
   *
   * `skipRecorded` belongs to the sweep alone. A sweep re-reads notifications this device may
   * already have captured and uploaded, and spending an upload to tell the server something it has
   * already been told is waste the live path never incurs. The live path must not skip: a queue row
   * that expired unsent leaves the retained content behind, and treating that as "already captured"
   * would turn an unsent capture into one that is never sent.
   */
  private fun capture(
    queue: CaptureQueueStore,
    tenantId: String,
    notification: StatusBarNotification,
    skipRecorded: Boolean = false
  ): Boolean {
    val capture = NotificationEnvelopeFactory.create(notification, System.currentTimeMillis())
    if (skipRecorded && queue.hasRecord(tenantId, capture.envelopeId)) return false
    queue.enqueue(tenantId, capture.envelopeId, "notification", capture.capturedAt, capture.json)
    // Kept separately from the outbox so acknowledging an upload does not also remove the
    // tenant's own ability to read what was captured.
    queue.retainContent(tenantId, capture.envelopeId, capture.capturedAt, capture.content)
    return true
  }
}
