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
