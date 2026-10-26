---
name: api-endpoints
description: Use when adding or changing an HTTP endpoint, route handler or API module (auth, authorization, request validation, error responses, rate limits, repositories) or its HTTP tests, or a background job handler that follows the same pattern.
---

# API endpoints

Read `.ticketflow/custom/api-endpoints.md` first if it exists; it adds to and overrides this file. It names the auth guard, the schema library, the error filter and a reference module of this repo.

## Handler checklist

1. **Authenticated by default.** A route is public only through an explicit opt-out. One module reads the caller (user id, token); handlers never parse tokens themselves.
2. **Authorized in code, before acting:** role or permission, and ownership of the object. Do not rely on a client-side check or on the hidden UI.
3. **Strict schemas** for body, params and query: reject unknown fields, bound `limit` and `offset`, type ids and enums.
4. **One error shape**, for example `{ error: { code, message_key } }`: localized through the message key, never a diagnostic, stack or provider message. Expected failures map to 4xx; unknown ones to 500 with no detail.
5. **A rate limit per route**, with the limit coming from config or settings.
6. **Thin handlers.** Rules go in the domain layer, data access in repositories. Lists are paginated and filtered in SQL.
7. **Side effects** (email, webhooks, slow work) go through idempotent jobs. Analytics are fire and forget. Never log tokens or credentials.
8. **Data access:** where the data layer has row-level security, user-scoped reads use the caller's identity so it applies; privileged writes use the server client after an explicit check that pins the owner to the caller.

## Tests per route

Happy path, 400 on bad input, 401 for no caller, 403 for the wrong role or owner, and 404. A test with a mocked database does not prove row security: add a real-role test (database practice) for any user-scoped read or write.

## Stack notes

- Next.js route handlers: wrap each in the shared auth and error helpers; no logic inline.
- NestJS: a global guard with a public decorator, an exception filter for the error shape, decorators for rate limits, a module per feature with repositories provided by token.
- Express, Fastify, Hono: middleware for auth and error mapping, one schema validator per route.

## Done when

- [ ] Auth, authorization, validation, rate limit and error shape are each present and covered by a test.
- [ ] New error keys exist in every locale and new settings keys are wired (i18n and runtime-settings practices when enabled).
- [ ] The full verify passes; user-facing endpoints have live-call evidence in the PR.
