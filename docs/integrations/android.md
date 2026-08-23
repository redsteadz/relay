---
status: accepted
owner: mobile
last_verified: 2026-08-24
sources:
  - https://docs.expo.dev/modules/overview/
  - https://support.google.com/googleplay/android-developer/answer/10208820
---

# Android Notifications And SMS

Expo local modules provide Kotlin access unavailable in Expo Go. Relay uses a custom development or
sideload APK and Continuous Native Generation.

`NotificationListenerService` can observe posted notifications after user grants system listener
access. Capture must support app allowlists, field minimization, encrypted offline queue, server
acknowledgement, and explicit revocation. Source cancellation is irreversible from Relay's point of
view and follows the stronger gates in [action model](../architecture/action-model.md).

`READ_SMS` and `RECEIVE_SMS` are sensitive Google Play permissions. Google documents possible
exceptions for device automation and SMS-based money management, subject to review. MVP therefore
uses sideload distribution and prominent consent. Non-SMS builds remain an architectural
requirement for later Play distribution.

iOS does not expose equivalent arbitrary notification or SMS ingestion. iOS scope is Gmail and
Relay's own inbox.
