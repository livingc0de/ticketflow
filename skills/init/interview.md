# Interview

Start from `<TF>/core/templates/config.json` and write the result to `.ticketflow/config.json` (the schema is `<TF>/core/docs/CONFIG.md`). Detect first, then show every detected value in one table with your recommendation first, and get it confirmed. Ask only what is left, one question at a time. Never invent a value you could not detect: leave the default and say so.

| Config row | How to detect or recommend |
|---|---|
| `repo`, `default_branch` | `gh repo view --json nameWithOwner,defaultBranchRef`. No question |
| `agents` | `.claude/` or CLAUDE.md: claude; `.codex/` or `.agents/`: codex; plus yourself |
| `models` | Claude: opus, sonnet, haiku; Codex: all null (inherit) |
| `verify.install` | from the lockfile: `npm ci`, `pnpm install --frozen-lockfile` or `yarn install --immutable` |
| `verify.command` | in order: the `verify` script, the `test` script, a Makefile target, `pytest`, `cargo test`, `go test ./...` |
| `verify.mode` | `ci`; `local-first` when CI is slow, costly or needs local services (then `timeout_min` 45) |
| `gate` | `ci/gate` and `Verify`, or the context already required (`gh api repos/<R>/rules/branches/<b>` and `gh api repos/<R>/branches/<b> --jq .protection.required_status_checks.contexts`). `inherit` false |
| `docs_only` | docs = `^docs/` and `^[^/]+\.md$`; ask which of those are really code |
| `reviewers` | see below |
| `areas` | existing `Area:` labels, else the top-level source directories. Labels in use outside the core set go to `custom/labels.json` |
| UI | front-end dependencies or templates found: recommend `live_verify_skill` and a `deferred_checks_issue` (create one) |
| `deploy_branch` | a non-default branch in the workflows' `on.push.branches`, else null. `ci.push_paths` null |
| `project` | projects linked to the repo (GraphQL `repository{projectsV2}`): reuse one (its number) or a new one (number 0, title = the repo name). No optional views: the Work Board and Roadmap always exist |
| `plans_dir`, `worktrees_dir` | reuse an existing worktree directory if there is one |
| `custom/` | draft the repo-specific workflow rules found in AGENTS.md, CLAUDE.md and the skills ticketflow replaces; show every draft before writing it |

## Reviewers

- Candidates: bot authors in `gh pr list --state all --limit 20 --json reviews,comments`, without CI and dependency bots.
- The exact login from `gh api repos/<R>/pulls/<n>/reviews --jq '.[].user.login'` (the REST form, with `[bot]`).
- `rereview_comment`: the most common human comment that mentions the bot. `no_findings_reaction`: from its reactions. `unavailable_pattern`: from its comments about a limit. `stale_after_min`: 30.
- The independent `pr-reviewer` role is always on and is never listed.
