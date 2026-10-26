---
name: provider-adapters
summary: Third-party providers sit behind one interface and one mock per category; SDKs are imported only inside their adapter; missing credentials fail closed in production.
question: Isolate third-party providers behind adapters?
detect: Two or more provider SDK dependencies (stripe, @aws-sdk/*, resend, openai, @anthropic-ai/sdk, twilio, posthog-*) or an adapters package. Recommend yes on either.
---

# Practice: provider-adapters

Payments, email, storage, AI, analytics and similar services are reached through your own interfaces, so features never depend on a vendor.

## What enabling it adds

- Skill `provider-adapters` (`.ticketflow/practices/provider-adapters/SKILL.md`): the layout, how to add an adapter or a category, webhooks, contract tests, the fail-closed rule.
- One AGENTS line and one PR checklist line.
- CI hint: a lint rule that forbids importing provider SDKs outside the adapters folder, and shared contract tests that run against the mock and every real adapter.

## Extend it

Record in `.ticketflow/custom/provider-adapters.md` the adapters folder, the registry, the env map names, where the provider order is set and the round-trip script, if any. It adds to and overrides the skill.

## Origin

Distilled from two production monorepos.
