# Changelog

## Unreleased

- **CI:** `ci.node` defaults to `null`: the managed job follows the repo's own `.nvmrc`, `.node-version` or `package.json` (`engines.node`/`volta.node`), else Node 22; an explicit `ci.node` still wins (#16).
- **Docs:** the README is a friendly guide (why, how it works, a ticket's journey, the processes, getting started, everyday use, FAQ); every reference doc opens with what it is for; the product is called TicketFlow in prose and plugin display names (#10).
- **gen-stubs:** a domain guide copied into an agent's rules folder keeps its relative links working (#12).
- **Codex:** skill and role stubs point at the canonical files, like the Claude ones, instead of carrying their text (#7).
- **protect:** `--replace-context <old>` replaces a superseded required gate context in one run; `--config` must come last (#2).
- **CI:** the managed job sets up Node.js at the new `ci.node` key (default `"22"`), with `actions/checkout` and `actions/setup-node` at v7 (#4).
- **CI:** every gate run, and the local fallback, checks the agent stubs with `gen-stubs --check`, so a stale or hand-edited stub fails the gate in every repo, not only here (#4).
- **doctor:** warns when `verify.command` runs in more than one step of `ci.yml`; `init` on an existing repo replaces the template's default steps instead of adding to them (#3).

## 0.1.0

First release. ticketflow is an agent-neutral, ticket-driven delivery workflow for GitHub repos, installed into a repo as a canonical `.ticketflow/` runtime with generated stubs for Claude Code and Codex.

- **Front doors:** a Claude plugin, a Codex plugin and `START.md`, all reaching the `init` and `sync` skills.
- **Skills and roles:** `implement-ticket` and `create-ticket`; the `ticket-planner`, `pr-reviewer` and `e2e-verifier` roles; action maps for Claude, Codex and any other agent.
- **Scripts:** `issue`, `project`, `sub-issue`, `tracker-next`, `labels`, `pr-wait`, `local-verify`, `merge`, `protect`, `gen-stubs`, `render`, `runtime`, `doctor` and `guard`, with the config loader, docs-only and inherit helpers.
- **Gate:** the `CI / Gate` commit status, docs-only and inherited results, a fail-closed local fallback when Actions refuses a job, and a standard branch ruleset.
- **Templates:** config, CI workflow, issue forms, PR template, AGENTS block, labels, Claude settings, Codex hook and rules.
- **Project:** the standard Projects v2 setup (eight statuses, Work Board and Roadmap, optional views) and Type, Priority, Effort, Needs and Area labels.
- **Practices:** ten optional rule sets under `practices/`.
- **Docs:** `README.md` and `core/docs/` (workflow, project, config, CI gate, reviewers, extending, security, token budget, upgrading).
