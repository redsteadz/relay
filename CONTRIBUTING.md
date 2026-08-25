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

## Graphify Memory

Generated `graphify-out/` content is disposable and must never be committed. Keep credentials, raw
messages, and real payloads out of the corpus and query text. Query an existing graph before reading
the repository broadly:

```bash
graphify query "How does ingestion reach durable storage?"
graphify path "API" "Supabase"
graphify explain "TenantCoordinator"
```

For mixed code and documentation changes, run a fresh deep extraction because incremental update is
code-oriented. Load `GEMINI_API_KEY` from the approved secret store without printing it, then run:

```bash
uvx --from "graphifyy[gemini,sql]==0.9.49" graphify extract . --backend gemini --mode deep --force --no-cluster --token-budget 5000 --max-concurrency 4
uvx --from "graphifyy[gemini,sql]==0.9.49" graphify extract . --backend gemini --mode deep --no-cluster --token-budget 2000 --max-concurrency 4
uv run --with "graphifyy[gemini,sql]==0.9.49" python scripts/validate-graphify.py
```

Use `graphify update .` only for code-only changes after an initial graph exists. Query-result logging
remains disabled for Relay; do not enable it for source content.
