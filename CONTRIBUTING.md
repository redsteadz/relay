# Contributing

All implementation starts from a GitHub issue with accepted scope and dependencies.

## Branch Flow

1. Confirm blocking issues are closed.
2. Branch from `dev` using `issue-<number>-short-name`.
3. Implement only issue acceptance criteria.
4. Update tests and linked memory documents when behavior or decisions change.
5. Open a pull request into `dev` and link it with `Closes #<number>`.
6. Complete privacy, migration, and provider-idempotency checks in the PR template.
7. Merge releases from `dev` to `main` through a dedicated release PR.

Direct pushes to `dev` and `main` are prohibited after repository bootstrap.

## Quality Gates

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Never weaken
a gate to make a change pass. Add a narrowly documented exception only when a platform tool cannot
participate in the shared gate.

Pull-request CI runs formatting, lint, type checks, and unit tests. Database CI runs only for API,
Pipeline, contract, crypto, script, or Supabase changes and skips redundant reset and full E2E steps.
Use manual workflow dispatch for full builds and local E2E before releases or high-risk changes.

## Sensitive Data

Fixtures must be synthetic. Logs must not contain message bodies, SMS content, access tokens,
provider credentials, OpenAI keys, or raw authorization headers. Any PR touching ingestion,
encryption, AI disclosure, notification dismissal, or provider actions requires security review.

## Optional Graphify

Generated `graphify-out/` content is disposable and must never be committed. Keep credentials, raw
messages, and real payloads out of the corpus and query text. Graphify is an optional local discovery
aid, not a CI check, release gate, or source of truth. Provider or extraction failure must not block a
change that passes canonical tests and documentation checks.

When a local graph already exists, it can be queried before reading the repository broadly:

```bash
graphify query "How does ingestion reach durable storage?"
graphify path "API" "Supabase"
graphify explain "TenantCoordinator"
```

Local generation may use `graphify` and `scripts/validate-graphify.py` on a best-effort basis. Never
load a provider key into repository files or logs. Query-result logging remains disabled for Relay;
do not enable it for source content.
