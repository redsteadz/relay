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

## Sensitive Data

Fixtures must be synthetic. Logs must not contain message bodies, SMS content, access tokens,
provider credentials, OpenAI keys, or raw authorization headers. Any PR touching ingestion,
encryption, AI disclosure, notification dismissal, or provider actions requires security review.
