package com.redsteadz.relaydeviceingress

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * How long a snoozed notification stays away before Android brings it back.
 *
 * Two hours: long enough that a batch of matching notifications stops interrupting an afternoon,
 * short enough that nothing is effectively lost if the rule was wrong. A snooze is the reversible
 * half of the capability, so its duration is chosen to keep it reversible in practice and not only
 * in principle.
 */
private const val SNOOZE_DURATION_MS = 2L * 60 * 60 * 1000

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
      // After the capture, always. Clearing a notification Relay failed to record would destroy the
      // only copy of something the reader asked it to keep.
      actIfAuthorized(configuration, notification)
    }
  }

  /**
   * Clears a notification a rule was authorized to clear, and nothing else.
   *
   * **This cannot stop a sound, and nothing a sideloaded app can do will.** Android ranks, posts and
   * alerts a notification before any listener is told it exists, so by the time this runs the phone
   * has already made its noise. The only hook that runs earlier is `NotificationAssistantService`,
   * which is `@SystemApi` -- absent from the public SDK and available to privileged system apps
   * only. So Relay clears a notification after the fact, and the quiet controls say so plainly and
   * point a person at Android's own per-app notification settings for the part Relay cannot do. See
   * [ADR-0017](../../../../../../../../docs/decisions/0017-notification-dismissal-after-posting.md).
   *
   * Snoozing is offered alongside cancelling because it is the reversible one: Android brings a
   * snoozed notification back, so a rule that turns out to be wrong costs a delay rather than a
   * message.
   *
   * Ordering is the part that matters most. The outcome is recorded before the notification is
   * touched, because afterwards this ledger is the only remaining evidence that Relay did it, and a
   * crash between the two must leave a record of an act that did not happen rather than an act with
   * no record.
   */
  private fun actIfAuthorized(
    configuration: NotificationCaptureConfiguration,
    notification: StatusBarNotification
  ) {
    try {
      val settings = NotificationSilenceSettings(applicationContext)
      val snapshot = settings.read(configuration.tenantId)
      if (snapshot.mode == "off") return

      val visible = NotificationEnvelopeFactory.view(notification.notification)
      val outcome = NotificationSilencePolicy.decide(
        snapshot,
        notification.packageName,
        "notification",
        visible.subject
      )
      if (outcome.decision == SilenceDecision.IGNORED) return

      val envelopeId = NotificationEnvelopeFactory.envelopeId(
        notification.packageName,
        notification.key,
        visible.subject,
        visible.body,
        visible.sender
      )
      CaptureQueueStore(applicationContext).use { queue ->
        queue.recordSilenceOutcome(
          configuration.tenantId,
          envelopeId,
          notification.packageName,
          outcome.filterRuleId,
          outcome.decision.wireName(),
          System.currentTimeMillis()
        )
      }
      NotificationDebugDiagnostics.event("quiet decision=${outcome.decision.wireName()}")

      // Only this notification's own key. Never `cancelAllNotifications`, and never a key derived
      // from anything but the notification that was just decided about.
      when (outcome.decision) {
        SilenceDecision.DISMISS -> cancelNotification(notification.key)
        SilenceDecision.SNOOZE -> snoozeNotification(notification.key, SNOOZE_DURATION_MS)
        else -> Unit
      }
    } catch (error: RuntimeException) {
      // A failure leaves the notification where it is, which is the safe direction.
      NotificationDebugDiagnostics.failure("quiet decision threw an exception", error)
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
