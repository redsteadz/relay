# Relay Verification Checks

Run checks from the repository root. On Windows, set `$env:CI = "true"`, use
`corepack.cmd pnpm`, and build `@relay/contracts` before API or mobile tests.

```powershell
$env:CI = "true"
corepack.cmd pnpm install --frozen-lockfile
corepack.cmd pnpm --filter @relay/contracts build
corepack.cmd pnpm --filter @relay/contracts test
corepack.cmd pnpm --filter @relay/api test
corepack.cmd pnpm --filter @relay/mobile test
corepack.cmd pnpm --filter @relay/mobile typecheck
corepack.cmd pnpm --filter @relay/mobile lint
```

For full verification:

```powershell
$env:CI = "true"
corepack.cmd pnpm format:check
corepack.cmd pnpm lint
corepack.cmd pnpm typecheck
corepack.cmd pnpm test
corepack.cmd pnpm build
corepack.cmd pnpm --filter @relay/mobile build-config:check
git diff --check
git status --short
```

Run `corepack.cmd pnpm exec supabase db reset` when changing migrations, constraints, RLS, or
database-backed integrations. `.pnpm-store/v11/index.db` is cache metadata; ignore `.pnpm-store/`,
not every `*.db`, because deterministic database fixtures may be valid repository inputs.
