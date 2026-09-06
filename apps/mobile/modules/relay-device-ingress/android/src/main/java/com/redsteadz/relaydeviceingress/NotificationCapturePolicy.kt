package com.redsteadz.relaydeviceingress

import android.app.Notification

/**
 * Why a notification was or was not captured.
 *
 * A refusal names its reason rather than returning a bare false, because a capture that silently
 * does not happen is the failure this adapter is hardest to diagnose from outside the device.
 */
internal enum class NotificationCaptureDecision {
  CAPTURE,
  OWN_NOTIFICATION,
  GROUP_SUMMARY,
  PACKAGE_NOT_ALLOWED
}

/**
 * Which notifications the tenant asked Relay to capture.
 *
 * Kept pure and separate from the listener for two reasons. A notification reaches Relay by two
 * routes -- posted live while the listener is bound, or found on the shade when it connects -- and
 * both must apply exactly one policy; a sweep that decided for itself what to capture would be a
 * second set of rules to keep in step with the first. And the decision is the part worth testing,
 * which it cannot be while it needs a `StatusBarNotification` and a running service.
 */
internal object NotificationCapturePolicy {
  fun decide(
    postingPackage: String,
    relayPackage: String,
    notificationFlags: Int,
    allowedPackages: Set<String>
  ): NotificationCaptureDecision {
    if (postingPackage == relayPackage) return NotificationCaptureDecision.OWN_NOTIFICATION
    // A grouped app must post a summary alongside its children. The summary only aggregates content
    // the children already carry, and it is rewritten on every new child, so capturing it duplicates
    // observations and churns identity for no added signal.
    if (notificationFlags and Notification.FLAG_GROUP_SUMMARY != 0) {
      return NotificationCaptureDecision.GROUP_SUMMARY
    }
    if (postingPackage !in allowedPackages) return NotificationCaptureDecision.PACKAGE_NOT_ALLOWED
    return NotificationCaptureDecision.CAPTURE
  }
}
