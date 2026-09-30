/**
 * Demo mode.
 *
 * A build-time flag rather than a runtime setting, set by the `demo` EAS profile and by
 * `pnpm --filter @relay/mobile demo:android`. Metro inlines `EXPO_PUBLIC_*`, so a production build
 * never carries a truthy value and every branch guarded by this collapses to the real path.
 *
 * What it changes is where data comes from and nothing else. Screens, presentation models, the
 * filter compiler, the classifier, the fact normalizer and the event extractor are the shipped ones;
 * only the Supabase client, the Relay API transport and the device capture module are replaced with
 * local stand-ins so the whole product can be shown without an account, a network, or a phone that
 * happens to receive an interesting notification while someone is watching.
 */
export function demoModeEnabled(): boolean {
  return process.env.EXPO_PUBLIC_RELAY_DEMO === "enabled";
}
