# Configuration

All of TicketFlow's settings for your repo live in one small file, `.ticketflow/config.json`. The setup writes it for you after a
short interview; afterwards you edit it whenever something changes (a new verify command, a review bot, an extra practice) and run
the generators so the rest follows. This page lists every key.

The file sits in the repo's git toplevel. Every script loads it with `core/lib/config.mjs`
(`--config <file>` overrides the path). The loader **fails closed**: a missing or unreadable file, bad JSON,
an unknown key, a wrong type, an invalid regex, or a `schema_version` other than the core's is an error
(scripts exit 2; the CI helpers print nothing on stdout, which CI reads as "run everything"). Prerequisites for the scripts: [UPGRADING.md](UPGRADING.md) (`doctor`).

Regexes are JavaScript regex source strings, tested against repo-relative paths with `/` separators.

| Key | Type | Default | Read by |
|---|---|---|---|
| `schema_version` | integer, must equal the core's (`1`) | required | `config`, `sync` |
| `repo` | `owner/name` | required | all scripts |
| `default_branch` | branch name | required | `inherit`, `local-verify`, `merge`, `pr-wait`, `render` |
| `verify.mode` | `ci` or `local-first` | required | `pr-wait` (a draft in `local-first` is not CI-checked), `render` |
| `verify.install` | string (shell) | `""` | `local-verify`, `render` |
| `verify.command` | non-empty string (shell) | required | `local-verify`, `render` |
| `verify.timeout_min` | integer 1..360 | `45` | `local-verify`, `render` |
| `gate.context` | string: the commit status that is the merge gate ([CI-GATE.md](CI-GATE.md)) | `"CI / Gate"` | `inherit`, `merge`, `pr-wait`, `local-verify`, `render` |
| `gate.check` | string: the Actions job (check run) behind the gate | `"Verify"` | `pr-wait`, `render` |
| `gate.inherit` | boolean | `false` | `local-verify` (and CI: call `inherit.mjs`), `render` |
| `gate.ci_files` | list of regexes | `[]` | `inherit` |
| `docs_only.docs` | list of regexes: paths that are documentation | `[]` | `docs-only`, `inherit`, `local-verify` |
| `docs_only.code` | list of regexes: paths that are code even if they match `docs` | `[]` | `docs-only`, `inherit`, `local-verify` |
| `reviewers` | list of reviewer objects | `[]` | `pr-wait` |
| `deploy_branch` | branch name or `null`; must differ from `default_branch` | `null` | `local-verify`, `render` |
| `project` | project object, or `null` for none | `null` | `project`, `tracker-next` |
| `agents` | unique list of `claude` / `codex`: the agents to generate stubs for | `[]` | `gen-stubs` |
| `models` | `{ claude?, codex? }`, each `{ strong, standard, light }`; a value is a model id (`[\w.:/[\]-]+`) or `null` (inherit: the stub names no model). Every agent in `agents` needs all three classes | `{}` | `gen-stubs` |
| `plans_dir` | repo-relative directory (no `..`, no leading `/`) where Technical plans are committed | `docs/plans` | skills, `render` |
| `worktrees_dir` | repo-relative directory for ticket worktrees (gitignored by `init`) | `.claude/worktrees` | skills |
| `live_verify_skill` | name of the repo's live-verification skill, or `null`; while `null` the `e2e-verifier` role gets no stub | `null` | `gen-stubs`, skills |
| `deferred_checks_issue` | number of the issue that lists deferred checks, or `null` | `null` | skills |
| `areas` | unique list of 1-44 character names (no commas, braces or control characters): the `Area:` labels and the issue forms' Area dropdown. `[]`: no Area | `[]` | `render`, skills |
| `practices` | unique list of names from `live-verify`, `runtime-settings`, `i18n`, `database`, `provider-adapters`, `api-endpoints`, `ui-screens`, `domain-guides`, `deploy-gating`, `analytics-events`: the optional practices copied to `.ticketflow/practices/` and wired into the stubs, the AGENTS block and the PR template | `[]` | `runtime`, `gen-stubs`, `render`, `doctor` |
| `ci.push_paths` | `null`: the CI workflow has no push run; `[]`: it runs on every push to the default branch; a list of globs: only when one of them changes. Must be `null` or `[]` while `deploy_branch` is set (the deploy signal needs every push) | `null` | `render` |
| `ci.node` | The Node.js version the managed CI job sets up: a major (`"24"`) or `major.minor[.patch]`, as a string. `null`: follow the repo's own `.nvmrc`, `.node-version` or `package.json` (`engines.node` or `volta.node`), else Node 22 (TicketFlow's scripts need 22 or newer) | `null` | `render` |

`gate.context` and `gate.check` must differ: the verdict is the commit status, and check runs are only read to
detect a refused Actions run.

A reviewer object (`reviewers`): see [REVIEWERS.md](REVIEWERS.md).

A project object (the GitHub Project, Projects v2, that tracks the repo's issues; see [PROJECT.md](PROJECT.md)):

| Key | Type | Default |
|---|---|---|
| `owner` | login of the user or organization that owns the project | required |
| `number` | integer, the project number; `0` means not created yet (`project setup` creates it) | required |
| `title` | string; required while `number` is `0` (setup finds or creates the project with exactly this title) | `null` |
| `views` | the optional views to create, a unique subset of `All Work`, `Initiatives`, `Open Decisions`, `P0/P1 Open` | `[]` |

`project setup` does not edit the config: after it creates a project, put the printed number in `project.number`.
`project add`, `project status` and `tracker-next` need `number` above `0`.

## Manifest, runtime, doctor and migration

See [UPGRADING.md](UPGRADING.md). 

## Built-in floors

The config can add to these, never remove them.

- Never docs (always code): `^\.ticketflow/`, `^\.github/workflows/`.
- CI files (a pull request that changes one never inherits a gate result): `^\.github/`, `^\.ticketflow/`, `^core/`.

## gen-stubs

`gen-stubs <canonical-dir> <target-repo> [--check]` writes the agent stubs from the canonical `skills/<n>/SKILL.md` and
`agents/<n>.md` (`.ticketflow/` in a repo, `core/` in TicketFlow itself) for the agents in `agents`. A stub is a thin file
in the agent's own format that points at the canonical file; a role stub carries the `model` for its `model_class`
(`strong`, `standard`, `light`) from `models`. A stub carries a `Generated by ticketflow gen-stubs` marker: a file at a stub
path without it is a conflict (exit 1, nothing written), and a marked file that is no longer expected (a deleted canonical
file, an agent dropped from `agents`) is removed. `--check` writes nothing and exits 1 on any difference. Exit 2: config or
canonical error, before any write.

Canonical frontmatter is `key: value` lines only. Skills: `name` (the directory name) and `description`. Roles also have
`model_class`, `effort` (`low`, `medium`, `high`, `xhigh`), `tools` (`read-only` or `full`) and an optional `needs_config`
(a config key that must not be `null`, otherwise the role gets no stub). A description starts with `Use when` and is at
most 300 characters.

## render

`render <templates-dir> <target-repo> [--check] [--keep <path>]... [--propose <dir>]` writes the CI workflow, the issue forms,
the PR template, the AGENTS block, the Claude settings, the Codex hook and rules, and `.ticketflow/custom/README.md` from
`core/templates/`. `<templates-dir>` is `core/templates` in the TicketFlow repo itself (the runtime is then `core/`) and any other
directory for a user repo (the runtime is `.ticketflow/`).

A managed block is delimited by `# ticketflow:begin <part>` and `# ticketflow:end <part>` (in Markdown: `<!-- ... -->`), each on its
own line. Render replaces the block of a part and leaves every other byte of the file alone, so the text between and around the blocks
(the `repo section`: your own CI steps, extra form fields, a top-level `env`) is yours. A file that exists without markers, or that
lacks a part render now wants, is a **conflict**: nothing is written (exit 1) and the file is listed; `--propose <dir>` writes the
suggested file for each conflict to `<dir>` (outside the target) to compare. A part that render no longer produces (the `deploy` job
once `deploy_branch` is `null`) is removed. Settings and hook files are merged by entry: your own entries stay, TicketFlow's are added
(or, for the hook, replaced). `--keep <path>` leaves one rendered file alone (it is neither written nor checked). `--check` writes
nothing and exits 1 on drift. Exit 2: config or template error.

The install and verify steps are written into `ci.yml` only when the file is created (they are the repo section): later edits of
`verify.install` or `verify.command` do not reach it, and `--check` does not flag that. `gate.context` and `gate.check` accept letters, digits,
spaces and `. / : ( ) # + @ & -`; `verify.install` and `verify.command` accept no control character, lone CR, unicode line break (U+0085, U+2028, U+2029) or `${{`; an area is not `None` (issue forms reserve it) and has no surrounding spaces. A file with a
CRLF marker line merges (the managed block is rewritten with LF). Invalid JSON in a settings or hooks file is a conflict.

How the rendered workflow decides and posts the gate: [CI-GATE.md](CI-GATE.md).
