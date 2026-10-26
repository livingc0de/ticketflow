---
name: provider-adapters
description: Use when touching a third-party provider integration (payments, email, storage, AI, analytics, push, search): adding or changing an adapter, interface, mock or registry, provider order, credentials or webhook verification.
---

# Provider adapters

Read `.ticketflow/custom/provider-adapters.md` first if it exists; it adds to and overrides this file. It names the adapters folder, the registry and the credential maps of this repo.

## Rules

- One interface and one mock per provider category. Provider SDKs are imported only inside their adapter, enforced by a lint rule. Features talk to the interface and never branch on which provider is active (`if (provider === 'mock')` is a bug).
- Credentials sit in a per-category env map (one JSON map keyed by provider). Provider order is a setting when the runtime-settings practice is enabled, otherwise one config value. Never log credentials.
- In production, missing credentials fail closed: no silent fallback to the mock. Check the active providers after wiring a new one.
- Webhooks: verify the signature inside the adapter, before trusting any payload; then enqueue an idempotent job. Normalize provider errors into one error type that the API layer maps to a 502 or 503.
- Check the provider's current official documentation (auth, API version, webhooks, limits) before writing code.
- No unused categories, mocks or providers. Internal ports are not providers.

## Add an adapter to an existing category

1. Implement the category interface in a new adapter file; import a heavy SDK lazily inside the factory.
2. Register it, and add its slug to the known providers and the default order, before the mock.
3. Add the SDK package to the lint rule's forbidden list.
4. Add the provider to the shared contract tests (mock and real must pass the same assertions) and a spec for its mapping and error logic.
5. Update the env example, and the provider docs.
6. Real keys are environment setup: if the owner must create a key or a webhook, say so in the ticket. Do not fake it.

## Add a category

Rare. The minimum is the interface, the mock, the registry entry, the order setting and the env map.

## Live check

A green health page does not prove a working key. Do one real round trip per changed adapter and record it in the PR, or call out the missing owner-side key. Use the live-verify practice when enabled.

## Stack notes

- Lazy SDK imports keep cold starts and test imports small.
- NestJS: a composition root builds the registry once and provides adapters by token.
- Next.js: provider modules are server-only; never import them from client components.

## Done when

- [ ] Contract tests pass for the mock and the real adapter, and the lint rule passes.
- [ ] Env example and order setting are updated.
- [ ] A live round trip is recorded, or the missing key is called out.
