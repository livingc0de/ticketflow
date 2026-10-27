# Changelog

## Unreleased

## 0.2.0

**Upgrade notes** (from 0.1.0):

- No config migration: `schema_version` stays 1. A blank `verify.command` is now a config error.
- `sync` re-renders `.github/workflows/ci.yml`. TicketFlow's job no longer sets up Node.js: if your own steps need a particular Node.js
  (or any other toolchain), add its setup step to the repo section in the update pull request. The job gains a "Check Agent Stubs" step:
  a stale or hand-edited stub now fails the gate (edits belong in `.ticketflow/custom/`). TicketFlow's steps run before the repo section on
  the runner's own Node.js, so a self-hosted runner needs Node.js 18.9 or newer installed (GitHub-hosted runners have it).
- If `doctor` warns `ci-steps`, delete the duplicate install or verify step from the repo section (`sync` never touches that section).
- Codex skill and role stubs become pointers, and domain-guide rule stubs are regenerated with working links.
- The "After merge" GitHub steps only add what the workflow needs. What 0.1.0 applied stays the repo's: squash only (repo settings and
  the ruleset's `allowed_merge_methods`), the branch settings and existing labels. `.github/ISSUE_TEMPLATE/config.yml` keeps its old
  marker lines, which are harmless and can be deleted.

- **Follows the repo:** `labels sync` creates missing labels and never changes one the repo has (only `custom/labels.json` entries are kept in line); `protect` no longer changes merge methods, branch deletion or update-branch settings unless the owner opts in (`--squash-only`, `--branch-settings`; its plan shows the current ones), and keeps an existing ruleset's bypass actors (it warns when the admin actor is missing or not `pull_request`, and the owner decides); `labels sync` lists differing TicketFlow labels and restyles them only with `--restyle`; `merge` uses the first of squash, rebase and a merge commit that the repo settings and the base rules allow; the CI jobs keep the repo's `runs-on` (new files: `ubuntu-latest`); `.github/ISSUE_TEMPLATE/config.yml` is written once, then the repo's; the bug form's Environment field is optional (Production, Staging, Development), the PR template's screenshots wording and the AGENTS block's "without asking" clause are gone (the last stays in the skill, which `custom/` can override); `project setup` leaves a same-named non-date field alone instead of stopping, and dates are never required. (#18).
- **Docs:** the README is a friendly guide (why, how it works, a ticket's journey, the processes, getting started, everyday use, FAQ); every reference doc opens with what it is for; the product is called TicketFlow in prose and plugin display names (#10).
- **gen-stubs:** a domain guide copied into an agent's rules folder keeps its relative links working (#12).
- **Codex:** skill and role stubs point at the canonical files, like the Claude ones, instead of carrying their text (#7).
- **protect:** `--replace-context <old>` replaces a superseded required gate context in one run; `--config` must come last (#2).
- **CI:** the managed job sets up no Node.js: TicketFlow's steps run on the runner's own Node.js and the repo section sets up whatever the project uses (any language or version); `actions/checkout` at v7. TicketFlow's scripts need Node.js 18.9 or newer, only to run themselves (#4, #16).
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
