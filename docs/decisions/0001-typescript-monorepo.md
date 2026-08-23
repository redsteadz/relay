---
status: accepted
date: 2026-08-24
owners: maintainers
---

# ADR-0001: TypeScript Monorepo

## Context

Mobile, API, Worker, and tests share ingress/filter/action contracts but deploy independently.

## Decision

Use pnpm workspaces and Turborepo with strict TypeScript. Keep deployables under `apps`, reusable
runtime-neutral code under `packages`, and database state under `supabase`. Omit Changesets because
packages are private application internals.

## Consequences

Contract changes compile against all consumers. Node is pinned to 22 for Expo/OpenNext compatibility.
Native Kotlin remains inside Expo local module and does not force JavaScript package publication.

Related: [system architecture](../architecture/system.md).
