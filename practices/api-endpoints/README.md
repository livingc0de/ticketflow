---
name: api-endpoints
summary: Every endpoint is authenticated unless marked public, authorized in code, validated, rate-limited, and returns errors as a code plus a message key.
question: Does this repo serve an HTTP API?
detect: app/api/**/route.ts, @nestjs/core, express, fastify or hono. Recommend yes on any of them.
---

# Practice: api-endpoints

One checklist for every HTTP route, whichever framework serves it.

## What enabling it adds

- Skill `api-endpoints` (`.ticketflow/practices/api-endpoints/SKILL.md`): the handler checklist and the per-route tests.
- One AGENTS line and one PR checklist line.
- CI hint: a test that lists every route with its auth mode and rate-limit key and fails on a new route that is missing from the list.

## Extend it

Record in `.ticketflow/custom/api-endpoints.md` the route layout, the auth guard and public opt-out, the permission helpers, the schema library, the error filter, the rate-limit keys and a reference module to copy. It adds to and overrides the skill.

## Origin

Distilled from two production monorepos.
