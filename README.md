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
| `apps/web`           | Static marketing landing page built with Next.js and exported as HTML    |
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

Configure an untracked `.env` from `.env.example` before starting Supabase. Replace application key
placeholders with local stack output. Never commit a credential or real source payload.

```bash
npx pnpm@11.23.0 install
npx pnpm@11.23.0 supabase:start
npx pnpm@11.23.0 --filter @relay/pipeline dev
npx pnpm@11.23.0 --filter @relay/api dev
npx pnpm@11.23.0 --filter @relay/mobile start
npx pnpm@11.23.0 --filter @relay/web dev
```

## Verify

```bash
npx pnpm@11.23.0 format:check
npx pnpm@11.23.0 lint
npx pnpm@11.23.0 typecheck
npx pnpm@11.23.0 test
npx pnpm@11.23.0 build
npx pnpm@11.23.0 e2e:local
```

`e2e:local` resets local Supabase and uses only the deterministic synthetic fixture under `fixtures/`.
It creates no remote resources and requires Docker.

Read [project memory](docs/memory/index.md), [contribution workflow](CONTRIBUTING.md), and
[security model](docs/security/privacy.md) before implementation work. Hosted database provisioning
and recovery procedures live in [Supabase operations](docs/operations/supabase.md).

## License

GNU Affero General Public License v3.0 or later. See `LICENSE`.
