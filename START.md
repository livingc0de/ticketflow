# TicketFlow: start here

TicketFlow is an agent-neutral, ticket-driven delivery workflow for GitHub repos: ticket, plan, implement, verify, review, merge, handoff. Its engineering method (understand, test first, debug by cause, verify, review) also applies to work without a ticket.
It is installed into a repo as a `.ticketflow/` folder with thin stubs for Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity and GitHub Copilot, and updated only when the owner chooses.

## Before you start

You need a shell, `git`, `gh` 2.48 or newer logged in with the `repo`, `project` and `workflow` scopes, `node` 18.9 or newer (only to run TicketFlow's own scripts), and `timeout`
(coreutils; on macOS `brew install coreutils`). The `init` procedure checks all of this for you.

## Set up or update a repo

- **Set up:** read `skills/init/SKILL.md` of https://github.com/livingc0de/ticketflow (raw: https://raw.githubusercontent.com/livingc0de/ticketflow/main/skills/init/SKILL.md) and follow it from section 0.
- **Update:** the same with `skills/sync/SKILL.md`, in a repo that already has `.ticketflow/manifest.json`.
- **Review upstreams:** from a TicketFlow checkout, read `skills/upstream/SKILL.md` and follow it when the monthly review is due or an upstream release needs review.
- Section 0 of the init and sync skills clones the release you install and continues from the clone's own copy, so those procedures always match the scripts they run. The upstream review runs from the TicketFlow checkout that owns its baseline.
- The skills say "dispatch a role", "ask the user" and similar actions. `core/agents-map/<your tool>.md` of the clone translates them (claude, codex, cursor, gemini, opencode, antigravity, copilot); any other agent uses `generic.md`.

## As a plugin

- Claude Code: `/plugin marketplace add livingc0de/ticketflow`, then `/plugin install ticketflow@ticketflow`. Ask: "set up ticketflow" or "update ticketflow".
- Codex: add `livingc0de/ticketflow` as a plugin marketplace (`codex plugin marketplace add livingc0de/ticketflow`) and install it (`codex plugin add ticketflow@ticketflow`).
- Cursor: Customize, then From GitHub Repository, `livingc0de/ticketflow`. Gemini CLI: `gemini extensions install https://github.com/livingc0de/ticketflow`.
- GitHub Copilot: `copilot plugin install livingc0de/ticketflow`, or add the repo to `chat.plugins.marketplaces` in VS Code. Antigravity: `agy plugin install https://github.com/livingc0de/ticketflow`.
- OpenCode has no plugin: ask it to read this file (its skills folder is `.agents/skills`). Any other tool: the same, through `AGENTS.md`.

## Rules for any agent

- Write only inside the target repo (and the temporary clone). Suggest user-level configuration changes, never make them.
- Ask before overwriting a file TicketFlow does not own, and before any write to GitHub (labels, Project, branch protection).
- Never use an admin bypass. A guard or permission prompt is a question for the owner, not an obstacle.
- Nothing reaches the default branch until the owner says so.
- At the end, list the manual steps the owner still has (trusting a guard hook, restarting the agent): `core/docs/TOOLS.md` of the clone has them per tool.
