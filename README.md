# ticketflow

An agent-neutral, ticket-driven delivery workflow for GitHub repos: ticket, plan, implement, verify, review, merge, handoff.

One workflow, one source, any agent, updated only when you choose to. Your agent follows the same skills, reviewer roles, gates and
Project flow whether it is Claude Code, Codex or another agent that can read files and run a shell.

## How it fits together

- **`.ticketflow/` is the canonical runtime** in your repo: the skills, roles, scripts, templates and docs, copied from a tagged
  release and changed only by an explicit `sync`. Your config (`.ticketflow/config.json`) and extensions (`.ticketflow/custom/`)
  are yours; `sync` never touches them.
- **Claude Code and Codex get generated stubs** (`.claude/`, `.agents/`, `.codex/`) built from the canonical files: each one points at
  them. Never edit a stub; change the canonical file and run `gen-stubs`. Other agents read `.ticketflow/` through the AGENTS.md block.
- **Generated GitHub files** (CI workflow, issue forms, PR template) carry managed blocks; your own steps and fields stay.
- **The merge gate is a commit status**, `CI / Gate`, enforced by a branch ruleset and the `merge` script. Admin bypass stays
  possible for the owner, and agents never use it on their own.

## Quickstart

Pick a front door. All three lead to the same `init` and `sync` procedures, which interview you, write the files, set up labels, the
Project and branch protection, and land the files through a setup pull request (a brand-new repo gets one confirmed direct push
instead). Every GitHub write follows a shown dry run and a yes; protection is applied after the setup pull request is merged, and
you decide when to merge.

- **Claude Code:** `/plugin marketplace add livingc0de/ticketflow`, then `/plugin install ticketflow@ticketflow`. Ask: "set up
  ticketflow" (later: "update ticketflow").
- **Codex:** `codex plugin marketplace add livingc0de/ticketflow`, then `codex plugin add ticketflow@ticketflow`. Ask the same.
- **Any other agent:** tell it to read
  [`START.md`](https://raw.githubusercontent.com/livingc0de/ticketflow/main/START.md) and follow it.

[START.md](START.md) also lists the rules every agent follows while setting up.

## What you get

1. **Ticket.** `create-ticket` files an issue as one shippable unit with an Execution section (tier, model and effort, planning route).
2. **Plan.** By default the `ticket-planner` role writes a technical plan, committed under `plans_dir`; easy changes may skip it with
   four stated reasons.
3. **Implement** in a worktree, one commit per task, with `Ticket #N` and never a closing keyword.
4. **Verify.** The gate status `CI / Gate` on the head commit, from CI or, when Actions refuses the job, a local fallback. Mode `ci`
   or `local-first`.
5. **Review.** The independent `pr-reviewer` role, plus any external reviewers you configure.
6. **Merge** only through `merge`: gate, up to date, review done, squash on the exact head.
7. **Handoff.** Status In Review, the issue stays open, a summary comment ends with a `Run:` line. Done only when you ask.

## Components

| Part | What |
|---|---|
| Skills | `implement-ticket` (claim to handoff) and `create-ticket` in `core/skills/`; `init` and `sync` in `skills/` (the front door) |
| Roles | `ticket-planner` (plans and diagnoses), `pr-reviewer` (independent review), `e2e-verifier` (live checks); `core/agents/` |
| Action maps | `core/agents-map/`: how Claude, Codex or any agent does "dispatch a role", "ask the user", "run in the background" |
| Scripts | `core/scripts/`: `issue`, `project`, `sub-issue`, `tracker-next`, `labels`, `pr-wait`, `local-verify`, `merge`, `protect`, `gen-stubs`, `render`, `runtime`, `doctor`, `guard` |
| Libraries | `core/lib/`: config loader and validator, `docs-only`, `inherit`, and the pure parts of the scripts |
| Templates | `core/templates/`: config, CI workflow, issue forms, PR template, AGENTS block, labels, Claude settings, Codex hook and rules |
| Guard | `core/guard.json`: the one list of bypass forms behind the Claude ask rules, Codex prompt rules and Codex hook |
| Practices | `practices/`: ten optional rule sets (live-verify, runtime-settings, i18n, database, provider-adapters, api-endpoints, ui-screens, domain-guides, deploy-gating, analytics-events) |

## Prerequisites

A shell, `git`, `gh` 2.48 or newer logged in with the `repo`, `project` and `workflow` scopes, `node` 22 or newer, and `timeout`
(coreutils; on macOS `brew install coreutils`) for the local fallback. `init` checks all of it.

## Documentation

In `core/docs/` (copied into your repo's `.ticketflow/docs/`):

- [WORKFLOW.md](core/docs/WORKFLOW.md): lifecycle, tiers, planning, verify modes, review, merge, handoff, branching
- [PROJECT.md](core/docs/PROJECT.md): statuses, views, labels, trackers
- [CONFIG.md](core/docs/CONFIG.md): every config key, generated files
- [CI-GATE.md](core/docs/CI-GATE.md): the gate status, docs-only, inheritance, the local fallback
- [REVIEWERS.md](core/docs/REVIEWERS.md): `pr-reviewer` and external reviewers
- [EXTENDING.md](core/docs/EXTENDING.md): `custom/`, Review Guidelines, practices, domain guides
- [SECURITY.md](core/docs/SECURITY.md): threat model, measured bypass modes, the guard
- [TOKEN-BUDGET.md](core/docs/TOKEN-BUDGET.md): what is always loaded, and how to keep it small
- [UPGRADING.md](core/docs/UPGRADING.md): `sync`, the manifest, held files, upgrade notes

Contributing: [AGENTS.md](AGENTS.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## Status

v0.1.0, the first release.

## License

MIT
