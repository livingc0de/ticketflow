# Changelog

## Unreleased

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
