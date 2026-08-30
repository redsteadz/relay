# Mobile Instructions

- Expo Continuous Native Generation is authoritative; generated `android/` and `ios/` stay ignored.
- Use a custom development build. Expo Go cannot provide notification-listener or SMS access.
- Keep capture adapters capability-driven so iOS and Play-safe variants can omit unsupported paths.
- Encrypt queued device payloads with Android Keystore-backed material before offline persistence.
- Do not request SMS permissions until prominent disclosure and consent UI are visible.
- Never dismiss a source notification from category or AI output alone.
- Keep transport contracts in `@relay/contracts`; do not create mobile-only wire shapes.
- Test UI on narrow Android screens and web before PR.
- Use `lib/observability.ts` for API/integration failures and `runInBackground` for intentional
  fire-and-forget work. UI messages stay deterministic and must not contain raw errors.

Canonical context: [Android ingestion](../../docs/integrations/android.md) and
[privacy](../../docs/security/privacy.md). Error handling must follow the canonical
[observability guide](../../docs/memory/observability.md).
