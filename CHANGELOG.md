# Changelog

## Unreleased

- Repository skeleton.
- Core: config loader and validator, docs-only and inherit helpers (WP1).
- Core: `pr-wait` (WP2).
- Core: `local-verify` (WP3).
- Core: `issue`, `project`, `sub-issue`, `tracker-next` and `labels` scripts, the `project` config section, `templates/labels.json` (WP4).
- Core: `merge`, `protect`, the agent guard (`guard.json`, `guard`) and `core/docs/SECURITY.md` with the measured bypass modes (WP5).
- Core: `gen-stubs`, the Claude and Codex adapters, the plugin manifests, `agents` and `models` config keys, a manifest version check (WP6). Templates moved to `core/templates/`.
- Core: the `ticket-planner`, `pr-reviewer` and `e2e-verifier` roles, the Claude, Codex and generic action maps, the `implement-ticket` and `create-ticket` skills, the `plans_dir`, `worktrees_dir`, `live_verify_skill` and `deferred_checks_issue` config keys (WP7, WP8).
- Core: `render`, the CI workflow, issue form, PR template, AGENTS block, settings, hook and rules templates, the `areas` and `ci.push_paths` config keys (WP9).
- Core: `runtime` (copies the runtime into a repo), `doctor` (read-only health check), the runtime manifest (`manifest.mjs`), `config validate` and `config migrate`, the `practices` config key, Area and custom labels in `labels`, the manifest record of the Claude settings entries in `render` (WP10).
- `START.md` and the `init` and `sync` skills.
- Practices: ten optional practices under `practices/` (live-verify, runtime-settings, i18n, database, provider-adapters, api-endpoints, ui-screens, domain-guides, deploy-gating, analytics-events), the `PRACTICES` list, practice skills and domain-guide rule files in `gen-stubs` (a symlink at a stub path is a conflict), practice lines in the AGENTS block and the PR template, a `practices` check in `doctor` (WP10b).
