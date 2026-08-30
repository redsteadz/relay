---
status: accepted
date: 2026-08-29
owners: mobile
---

# ADR-0009: Local Diagnostics For Internal Android Capture Builds

## Context

Relay's permission-free development build already supports unauthenticated, on-device notification
capture diagnostics. SMS remained testable only after installing a sideload build, authenticating,
and connecting the upload backend. That made it difficult to verify the native inbox reader,
receiver, sender allowlist, encryption, and queue behavior independently of hosted services.

SMS permissions must remain confined to the sideload branch. Local convenience must not bypass the
prominent disclosure, exact sender allowlist, Android runtime permission, encrypted persistence, or
seven-day queue expiry required by issue #19.

## Decision

JavaScript debug runtimes for both internal Android variants may enter a local diagnostic mode
without authentication. The permission-free `development` variant can diagnose notifications. The
`sideload` variant can diagnose notifications and SMS because only that variant declares SMS
permissions and background components.

Local diagnostics use one stable synthetic tenant and never run authenticated capture sync. Native
captures remain encrypted with tenant-bound Android Keystore material. The Sources screen may bridge
only minimized source-specific preview fields while it is focused and foregrounded under Android
`FLAG_SECURE`; it clears previews on blur, background, and unmount and never writes them to logs,
JavaScript storage, or the network.

Disclosure, an exact nonempty sender allowlist, and Android's runtime permission remain mandatory
before the first SMS provider read. Release sideload builds still require authentication. Signing in
or entering any nonlocal runtime deletes the synthetic key, queue, and source configuration before
authenticated capture is prepared, so controls must be consented and saved again.

## Consequences

Developers can verify SMS capture on a physical phone without provisioning a Relay account or
backend. They must still generate and install the sideload variant and approve Android's SMS access;
the normal development APK remains permission-free. Local previews intentionally contain source
content, so the secure-window and lifecycle gates are part of the security boundary and require
focused tests when changed.

The local Android runner always regenerates the native project before switching variants. This
prevents a sideload manifest from being mistaken for the permission-free development manifest.

## Sources

- [Android notification and SMS integration](../integrations/android.md)
- [Relay privacy lifecycle](../security/privacy.md)
- [Android runtime permission workflow](https://developer.android.com/training/permissions/requesting)
