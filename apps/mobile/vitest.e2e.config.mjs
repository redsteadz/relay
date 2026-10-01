import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The device-boundary harness, run only by `pnpm e2e:local --device`.
 *
 * Kept apart from `vitest.config.mjs` so `pnpm test` never collects it: it needs the local Supabase,
 * API and pipeline that `scripts/local-e2e.mjs` starts, and a session that script signs in.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 120_000,
  },
});
