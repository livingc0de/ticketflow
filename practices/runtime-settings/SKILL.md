---
name: runtime-settings
description: Use when introducing a configurable value (threshold, limit, price, flag, provider order, URL, retention or grace period), reading a setting, adding, renaming or deleting a settings key, or handling env vars and credentials.
---

# Runtime settings

Read `.ticketflow/custom/runtime-settings.md` first if it exists; it adds to and overrides this file. It names the store, the seed file, the schema and the readers of this repo.

Operational values live in a settings store that is read at runtime, with a safe default. They are not constants in code.

## What is not a setting

- **Secrets and credentials.** They live in env or a secret store, as one JSON map per category (for example one map of provider keys per provider category). Never in the settings store, never in a client bundle.
- **True invariants** (protocol constants, enum values) are not configuration.
- **Per-user preferences** belong in profile or preference data.

## Model

- One source lists the keys: a seed or bootstrap file with a default and a description per key. A schema validates the whole tree and decides what is required. Keys the schema does not know must fail or be reported, not be dropped silently.
- An idempotent apply step inserts missing keys and never overwrites a value an operator changed. A changed default therefore needs an explicit update on each existing environment.
- Keys are namespaced (`category/sub/name`). Values are typed.

## Read a setting

- Read per call or per job, through the app's runtime context, with a short TTL cache. Never copy a setting into a constant, a constructor or a module-level variable at boot: it goes stale.
- A setting that only takes effect at boot (for example provider order) says so in its description, and changing it needs a restart.
- Feature code never queries the store or the process env directly.
- Clients get a public subset through an endpoint. Never expose a key the client does not need, and never read the table from a browser.

## Add a key

Do every step in one PR:
1. Default and description in the seed.
2. Type and validation in the schema.
3. A reader, read per call.
4. Regenerate any derived SQL or docs.
5. Apply it to every shared environment before the merge when a deploy follows the merge; record what you ran in the PR.
6. A test that proves the code reads the setting and not a literal.
7. An operator note in the docs only if the key needs one.

## Remove or rename a key

Delete the row only after no deployed code reads it. Grep the key everywhere, including admin editors and docs. A rename is an add, a switch of readers, then a removal.

## Stack notes

- Postgres: a `settings` table with a jsonb value keyed by `category/sub/name`.
- Supabase: no browser reads of the table; serve the public subset from an endpoint.
- Next.js: a server-side cache with a TTL; client components get props, not the store.
- NestJS: an injected runtime context whose settings tree reloads on the TTL; read it per call.

## Done when

- [ ] No new literal limit, threshold, flag or URL remains in the diff.
- [ ] Seed, schema, reader and test exist, and the drift test (if any) passes.
- [ ] No secret was added to the store.
