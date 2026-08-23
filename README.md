# Relay

Relay turns Gmail, Android notifications, and SMS into a quiet, explainable inbox and
user-approved actions. It normalizes and deduplicates source data, extracts useful facts and
events, evaluates versioned filters, and dispatches structured actions to providers such as
Google Tasks and Nextcloud Budget.

## Status

Foundation only. Current code is a local walking skeleton and contract boundary, not a production
service. Live connector credentials, provider calls, Gmail verification, and Android capture are
tracked as GitHub issues.

## Repository

| Path                 | Responsibility                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| `apps/mobile`        | Expo Android-first client and native capability shell                    |
| `apps/api`           | Next.js authentication and ingestion boundary on Cloudflare OpenNext     |
| `apps/pipeline`      | Cloudflare Queue, Durable Object, Workflow, and provider dispatch        |
| `packages/contracts` | Runtime-validated shared wire contracts                                  |
| `packages/domain`    | Pure filter and deduplication logic                                      |
| `packages/crypto`    | WebCrypto envelope encryption primitives                                 |
| `supabase`           | PostgreSQL migrations, RLS, auth, and local development                  |
| `docs`               | Linked product, architecture, security, integration, and decision memory |

## Prerequisites

- Node.js 22.23.2
- pnpm 11.23.0
- Docker for local Supabase
- Android Studio for the custom Expo development build

The host currently lacks Corepack. Run pnpm through `npx pnpm@11.23.0` until pnpm is installed.

## Start Locally

```bash
npx pnpm@11.23.0 install
npx pnpm@11.23.0 supabase:start
npx pnpm@11.23.0 --filter @relay/pipeline dev
npx pnpm@11.23.0 --filter @relay/api dev
npx pnpm@11.23.0 --filter @relay/mobile start
```

Copy `.env.example` values into untracked runtime-specific environment files. Never commit a
credential or real source payload.

## Verify

```bash
npx pnpm@11.23.0 format:check
npx pnpm@11.23.0 lint
npx pnpm@11.23.0 typecheck
npx pnpm@11.23.0 test
npx pnpm@11.23.0 build
```

Read [project memory](docs/memory/index.md), [contribution workflow](CONTRIBUTING.md), and
[security model](docs/security/privacy.md) before implementation work.

## License

GNU Affero General Public License v3.0 or later. See `LICENSE`.
