# TicketFlow: start here

TicketFlow is an agent-neutral, ticket-driven delivery workflow for GitHub repos: ticket, plan, implement, verify, review, merge, handoff.
It is installed into a repo as a `.ticketflow/` folder with thin stubs for Claude Code and Codex, and updated only when the owner chooses.

## Before you start

You need a shell, `git`, `gh` 2.48 or newer logged in with the `repo`, `project` and `workflow` scopes, `node` 22 or newer, and `timeout`
(coreutils; on macOS `brew install coreutils`). The `init` procedure checks all of this for you.

## Set up or update a repo

- **Set up:** read `skills/init/SKILL.md` of https://github.com/livingc0de/ticketflow (raw: https://raw.githubusercontent.com/livingc0de/ticketflow/main/skills/init/SKILL.md) and follow it from section 0.
- **Update:** the same with `skills/sync/SKILL.md`, in a repo that already has `.ticketflow/manifest.json`.
- Section 0 of each skill clones the release you install and continues from the clone's own copy, so the procedure always matches the scripts it runs.
- The skills say "dispatch a role", "ask the user" and similar actions. If you have no action map of your own, `core/agents-map/generic.md` of the clone translates them.

## As a plugin

- Claude Code: `/plugin marketplace add livingc0de/ticketflow`, then `/plugin install ticketflow@ticketflow`. Ask: "set up ticketflow" or "update ticketflow".
- Codex: add `livingc0de/ticketflow` as a plugin marketplace (`codex plugin marketplace add livingc0de/ticketflow`) and install it (`codex plugin add ticketflow@ticketflow`).

## Rules for any agent

- Write only inside the target repo (and the temporary clone). Suggest user-level configuration changes, never make them.
- Ask before overwriting a file ticketflow does not own, and before any write to GitHub (labels, Project, branch protection).
- Never use an admin bypass. A guard or permission prompt is a question for the owner, not an obstacle.
- Nothing reaches the default branch until the owner says so.
