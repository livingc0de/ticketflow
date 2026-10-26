---
name: database
summary: One schema of record, additive changes before the code that needs them, deny by default, and every allow and deny path tested as the real roles.
question: Does this repo own a database schema?
detect: Schema SQL files (*.sql), supabase/, prisma/, drizzle.config.*, migrations/, or pg or @supabase/supabase-js as a dependency. Recommend yes on any of them.
---

# Practice: database

A repo that owns a schema keeps one record of it, changes shared databases safely, and treats row security as the default.

## What enabling it adds

- Skill `database` (`.ticketflow/practices/database/SKILL.md`): the schema-of-record rule, how to apply SQL to a live database, row-level security, role tests.
- Two AGENTS lines and one PR checklist line.
- CI hint: apply the bootstrap SQL twice to an empty database in CI. A file that stops being re-runnable then fails the PR.

## Extend it

Record in `.ticketflow/custom/database.md` where the schema of record lives, how a live database is reached (never the credentials), the environments, the role-test harness and the ownership lists your code keeps in sync. It adds to and overrides the skill.

## Origin

Distilled from two production monorepos.
