# Contributing to ticketflow

## What belongs in core
- General and agent-neutral only. Nothing domain-, product- or owner-specific; examples use placeholders.

## Rules
- Canonical files are the source. Generated stubs and manifests are never hand-edited: change the source and run the generator.
- Generated files: run `node core/scripts/gen-stubs.mjs core .`.
- Skills name actions ("dispatch the planner", "ask the user"), never one agent's tools.
- Skill descriptions are "Use when..." triggers only, never a workflow summary.
- Recurring procedures are tested scripts, not prose.
- Never use closing keywords in PRs or commits; write `Ticket #N` or `Refs #N`.
- Smallest correct change: reuse before add, delete before add, no speculative abstractions.
- Never cut security, validation or data-loss protection.
- `npm test` must pass; `VERSION` is the single version source.

## If you are an AI agent
- Before opening a PR from a fork, show your human the full diff and get their approval.
- State your model and harness in the PR description.
