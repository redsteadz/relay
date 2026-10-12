package com.redsteadz.relaydeviceingress

/** The event name, shared by the module that declares it and the service that fires it. */
internal const val CAPTURE_ENQUEUED_EVENT = "onCaptureEnqueued"

/**
 * How the notification listener tells a running app that something arrived.
 *
 * The listener is bound by the system and knows nothing about JavaScript; the module knows about
 * JavaScript and is never called when a notification posts. This is the one wire between them, and
 * it carries no capture content -- only that there is something new to sync, because everything
 * about the capture itself is already in the encrypted queue the sync pass reads.
 *
 * `listening` is set from `OnStartObserving`/`OnStopObserving`, so a notification that arrives with
 * no subscriber costs a boolean read rather than a dispatch into a runtime that would drop it.
 */
internal object CaptureEventBridge {
  @Volatile var listening: Boolean = false

  /**
   * Set while a module instance exists. Cleared on destroy, because a stale reference would dispatch
   * into a dead runtime.
   */
  @Volatile var emit: ((String) -> Unit)? = null

  /** Never throws: a capture is already safely queued by the time this runs, and nothing about
   * delivery depends on the event arriving. */
  fun captureEnqueued(sourceKind: String) {
    if (!listening) return
    try {
      emit?.invoke(sourceKind)
    } catch (error: RuntimeException) {
      NotificationDebugDiagnostics.failure("capture event dispatch threw an exception", error)
    }
  }
}
