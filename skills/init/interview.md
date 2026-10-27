# Interview

Start from `<TF>/core/templates/config.json` and write the result to `.ticketflow/config.json` (the schema is `<TF>/core/docs/CONFIG.md`). Detect first, then show every detected value in one table with your recommendation first, and get it confirmed. Ask only what is left, one question at a time. Never invent a value you could not detect: leave the default and say so.

| Config row | How to detect or recommend |
|---|---|
| `repo`, `default_branch` | `gh repo view --json nameWithOwner,defaultBranchRef`; an empty new repo returns an empty branch name: use the local `git init -b` branch (`main`). No question |
| `agents` | `.claude/` or CLAUDE.md: claude; `.codex/` or `.agents/`: codex; plus yourself |
| `models` | Claude `{strong: opus, standard: sonnet, light: haiku}`; Codex `{strong: null, standard: null, light: null}` (inherit) |
| `verify.install` | from the lockfile: `npm ci`, `pnpm install --frozen-lockfile` or `yarn install --immutable`; the toolchain setup (for example `actions/setup-node`, `setup-python`) goes in the repo section of `ci.yml` |
| `verify.command` | in order: the `verify` script, the `test` script, a Makefile target, `pytest`, `cargo test`, `go test ./...` |
| `verify.mode` | `ci`; `local-first` when CI is slow, costly or needs local services (then `timeout_min` 45) |
| `gate` | `CI / Gate` and `Verify`, or the context already required (`gh api repos/<R>/rules/branches/<b>` and `gh api repos/<R>/branches/<b> --jq .protection.required_status_checks.contexts`). `inherit` false |
| `docs_only` | docs = `^docs/` and `^[^/]+\.md$`; ask which of those are really code |
| `reviewers` | see below |
| `areas` | existing `Area:` labels, else the top-level source directories. Labels in use outside the core set go to `custom/labels.json` |
| UI | front-end dependencies, `playwright.config.*` or `e2e/` found: the `live-verify` practice is recommended through the Practices questions; when it is enabled set `live_verify_skill` to `live-verify` (otherwise the `e2e-verifier` role gets no stub). Also recommend a `deferred_checks_issue` (create one). A repo that keeps its own live-verification skill leaves the practice off and names that skill in `live_verify_skill` |
| `deploy_branch` | a non-default branch in the workflows' `on.push.branches`, else null. `ci.push_paths` null |
| `project` | projects linked to the repo (GraphQL `repository{projectsV2}`): reuse one (its number) or a new one (number 0, title = the repo name). No optional views by default: the Work Board and Roadmap always exist |
| `practices` | see Practices below |
| `plans_dir`, `worktrees_dir` | reuse an existing worktree directory if there is one |
| `custom/` | draft the repo-specific workflow rules found in AGENTS.md, CLAUDE.md and the skills ticketflow replaces; show every draft before writing it |

## Reviewers

- Candidates: bot authors in `gh pr list --state all --limit 20 --json reviews,comments`, without CI and dependency bots.
- The exact login from `gh api repos/<R>/pulls/<n>/reviews --jq '.[].user.login'` (the REST form, with `[bot]`).
- `rereview_comment`: the most common human comment that mentions the bot. `no_findings_reaction`: from its reactions. `unavailable_pattern`: from its comments about a limit. `stale_after_min`: 30.
- The independent `pr-reviewer` role is always on and is never listed.

## Practices

- Read the frontmatter of every `<TF>/practices/*/README.md`: `question`, `detect` and `summary`. Check each `detect` signal against the repo.
- Ask all the questions in one batched message, each with yes or no recommended from what you detected.
- Before enabling a practice that has a skill (`<TF>/practices/<n>/SKILL.md`), look for an unmarked `.claude/skills/<n>` or `.agents/skills/<n>`. If one exists, show it and ask: move its repo-specific content to `.ticketflow/custom/<n>.md` and delete it, or skip the practice.
- `domain-guides`: the guides are the repo's own product content at `docs/agents/<name>.md` (a `paths:` list in the frontmatter); every `*.md` in that folder is a guide (an index file needs another name or place). An existing `.claude/rules/<name>.md` symlink to a guide is replaced by a generated rule file after you delete the symlink; an existing real rule file moves into `docs/agents/<name>.md` (with a `paths:` list) first.
- The enabled names go into `practices` in the config; section 3 of the skill copies their folders and wires the skills, rule files, AGENTS lines and PR lines.
