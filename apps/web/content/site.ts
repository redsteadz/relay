/**
 * Document-level strings, spread into `landing.site` so the page reads them like every other
 * string. They live here because `vite.config.ts` substitutes the title and description into
 * index.html at build time, and Vite's config loader walks whatever the config imports. Keep this
 * module import-free so that graph never reaches a component or a CSS module.
 */
export const site = {
  title: "Relay · Your notifications, with receipts",
  description:
    "Relay turns Gmail, Android notifications, and SMS into a quiet, explainable inbox and actions you approve. Open source, self-hostable, AGPL-3.0.",
  skipLink: "Skip to content",
} as const;
