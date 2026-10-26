---
name: database
description: Use when changing the database (tables, columns, indexes, functions, triggers, row-level policies, roles, grants, seed data), applying SQL to a live database, or writing code that reads or writes the database with a user or privileged client.
---

# Database

Read `.ticketflow/custom/database.md` first if it exists; it adds to and overrides this file. It names the schema files, the environments and the test harness of this repo.

## Schema of record

- One schema of record in the repo: bootstrap SQL or a migration chain. DDL can be re-run (`if not exists`, `create or replace`, `drop policy if exists`, inserts that skip existing rows).
- With a migration chain, never edit an applied migration; add a new one.
- A change updates the schema of record, the row types and repositories, and any ownership or deletion lists the code keeps.

## Live databases

- When a deploy follows the merge, a shared database gets additive changes (new tables, nullable columns, new functions) before the merge. Destructive changes (drop, rename, tighter constraint) come after no deployed code reads the object.
- Run live SQL in one transaction that stops on the first error. Put the exact SQL and the environment in the PR.
- Never print connection strings or paste them into a PR or log.
- Never reset, seed or truncate a shared database without the owner's OK.
- After a change that an API layer reads through a schema cache, reload that cache.

## Security model

- Deny by default: row security is on for every table. A server-only table gets an explicit deny for clients.
- Clients never write privileged columns (status, roles, scores, amounts, visibility). Those writes happen server-side with the privileged client, after a permission or state check in code. Client policies are read-only or limited to a column list; a user's own rows may keep a write policy that checks the account is active.
- Public reads expose only what is meant to be public: no secrets or solution fields, no per-user rows; expose aggregates instead.
- Policy helper functions run with fixed `search_path`; keep their execute grants as the policies need them.
- A test pins the grants, so a stray privilege fails CI.

## Writes and reads

- A multi-step write is atomic: one function or transaction, with one documented lock order.
- Filter and aggregate in SQL, never in application loops. Paginate. Mind row caps of the data layer.

## Test as the real roles

For every policy change, prove the allowed path works and the forbidden path is rejected, as the real roles (anonymous, user, privileged), against a real database. A mocked database does not prove row security.

## Stack notes

- Postgres: `psql -1 -v ON_ERROR_STOP=1 -f change.sql` for the single transaction; `FOR NO KEY UPDATE` when locking rows you will not delete.
- Supabase: the service role only on the server; revoke default anon and authenticated privileges on new objects; column-level grants; `NOTIFY pgrst, 'reload schema'` after a change PostgREST reads.
- Prisma and Drizzle: the migration chain is the record; never edit an applied migration.

## Done when

- [ ] The schema of record reflects the change and re-applies cleanly; the applied SQL is in the PR.
- [ ] Allow and deny paths are tested as real roles; the full verify passes.
- [ ] The security docs are updated if the access model changed.
