# Contributing to ticketflow

<!-- ticketflow:begin agents -->
## Ticket workflow (ticketflow)

- Ticket work follows the `implement-ticket` and `create-ticket` skills and your agent's action map. Extensions go in `.ticketflow/custom/`, never in the skills.
- Read issues with `node core/scripts/issue.mjs <N>`, never `gh issue view`. The Project is Projects v2 only, through `project.mjs`.
- Plan by default; plans are committed under `docs/plans`. Never claim a check that did not run.
- Write `Ticket #N` in PRs and commits, never a closing keyword (Closes, Fixes, Resolves).
- **Merge only with `node core/scripts/merge.mjs <PR>`**, and without asking once its gates pass.
- **Never use the admin bypass on your own initiative:** `--admin`, a push to `main`, a merge or a status post through the API past missing checks, a protection change. Only when the user explicitly asks for that action.
- Hand off in In Review; Done only when the owner asks.
- Fix findings (reviews, CI, smoke checks) in the running ticket; only a big or unrelated problem gets its own issue.
- The Review Guidelines of this file apply to every reviewer.
<!-- ticketflow:end agents -->

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
