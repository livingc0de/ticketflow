# ticketflow config

`.ticketflow/config.json` in the repo's git toplevel. Every script loads it with `core/lib/config.mjs`
(`--config <file>` overrides the path). The loader **fails closed**: a missing or unreadable file, bad JSON,
an unknown key, a wrong type, an invalid regex, or a `schema_version` other than the core's is an error
(scripts exit 2; the CI helpers print nothing on stdout, which CI reads as "run everything").

Regexes are JavaScript regex source strings, tested against repo-relative paths with `/` separators.

| Key | Type | Default | Read by |
|---|---|---|---|
| `schema_version` | integer, must equal the core's (`1`) | required | `config`, `sync` |
| `repo` | `owner/name` | required | all scripts |
| `default_branch` | branch name | required | `inherit`, `local-verify`, `pr-wait`, `render` |
| `verify.mode` | `ci` or `local-first` | required | `pr-wait` (a draft in `local-first` is not CI-checked), `render` |
| `verify.install` | string (shell) | `""` | `local-verify`, `render` |
| `verify.command` | non-empty string (shell) | required | `local-verify`, `render` |
| `verify.timeout_min` | integer 1..360 | `45` | `local-verify`, `render` |
| `gate.context` | string: the commit status that is the merge gate | `"ci/gate"` | `inherit`, `pr-wait`, `local-verify`, `render` |
| `gate.check` | string: the Actions job (check run) behind the gate | `"Verify"` | `pr-wait`, `render` |
| `gate.inherit` | boolean | `false` | `local-verify` (and CI: call `inherit.mjs`), `render` |
| `gate.ci_files` | list of regexes | `[]` | `inherit` |
| `docs_only.docs` | list of regexes: paths that are documentation | `[]` | `docs-only`, `inherit` |
| `docs_only.code` | list of regexes: paths that are code even if they match `docs` | `[]` | `docs-only`, `inherit` |
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
| `ci.push_paths` | `null`: the CI workflow has no push run; `[]`: it runs on every push to the default branch; a list of globs: only when one of them changes. Must be `null` or `[]` while `deploy_branch` is set (the deploy signal needs every push) | `null` | `render` |

`gate.context` and `gate.check` must differ: the verdict is the commit status, and check runs are only read to
detect a refused Actions run.

A reviewer object:

| Key | Type | Default |
|---|---|---|
| `name` | string | required |
| `login` | GitHub login of the reviewing account | required |
| `rereview_comment` | string a re-review is requested with, or `null` | `null` |
| `no_findings_reaction` | a GitHub reaction content (`+1`, `-1`, `laugh`, `confused`, `heart`, `hooray`, `rocket`, `eyes`) the account leaves when it has no findings, or `null` | `null` |
| `unavailable_pattern` | regex (case-insensitive) matched against the account's issue comments to detect "out of quota", or `null` | `null` |
| `done_pattern` | regex with a named group `sha`, or `null`. The reviewer is done when the **last** match across the account's issue comments (bodies as currently edited, ordered by last update) captures a `sha` of 7 or more hex characters that is a prefix of the head | `null` |
| `stale_after_min` | integer minutes after which a silent reviewer no longer blocks, or `null` | `null` |

Example login: `review-bot[bot]`.

`done_pattern` is for a bot that posts no review when it has no findings, and instead keeps one summary comment
that it edits in place, with a machine line such as
`review-state:v1 {"code_review":{"commit_sha":"<40-hex>","status":"completed"}}` (key order not guaranteed).
An order-independent pattern for that line (JSON string, so backslashes are doubled):

```json
{ "name": "bot", "login": "review-bot[bot]",
  "done_pattern": "review-state:v1 (?=[^\\n]*\"commit_sha\":\"(?<sha>[0-9a-f]{7,40})\")(?=[^\\n]*\"status\":\"(?:completed|failed)\")" }
```

A state still `running`, or naming an older commit, does not match the head, so the reviewer stays pending.

A project object (the GitHub Project, Projects v2, that tracks the repo's issues):

| Key | Type | Default |
|---|---|---|
| `owner` | login of the user or organization that owns the project | required |
| `number` | integer, the project number; `0` means not created yet (`project setup` creates it) | required |
| `title` | string; required while `number` is `0` (setup finds or creates the project with exactly this title) | `null` |
| `views` | the optional views to create, a unique subset of `All Work`, `Initiatives`, `Open Decisions`, `P0/P1 Open` | `[]` |

`project setup` does not edit the config: after it creates a project, put the printed number in `project.number`.
`project add`, `project status` and `tracker-next` need `number` above `0`.

## Built-in floors

The config can add to these, never remove them.

- Never docs (always code): `^\.ticketflow/`, `^\.github/workflows/`.
- CI files (a pull request that changes one never inherits a gate result): `^\.github/`, `^\.ticketflow/`, `^core/`.

## Migration

`schema_version` is an integer. The release version lives in the manifest, not here. `loadConfig` never changes
a config: an older file is an error ("run sync"), a newer one is an error ("core older than config: sync").
Only `sync` calls `migrate(raw)`, which applies `MIGRATIONS[n]` (config at `n` to config at `n + 1`) in order
and throws on a gap.

## Gate description contract

Whatever posts the gate status writes one of these descriptions; `inherit` and `pr-wait` read them.

- `actions #<run id>`: a full run by Actions. A failure with this description is final.
- `actions #<run id> docs-only`: Actions, docs-only diff.
- `local <host> <arch> node <version>`: a full local run. A failure with this description can be re-run locally
  while Actions still refuses the job.
- `docs-only (local <host>)`: local, docs-only diff.
- `inherited <sha7>: only docs-only <default_branch> changes merged in`: the result of the full run at `<sha7>`.

Only the first and third forms count as a full run to inherit from.

## Prerequisites

`gh` 2.48 or newer (`--paginate --slurp`), `git`, Node 22 or newer, and `timeout` (coreutils; on macOS
`brew install coreutils`) for `local-verify`.

## local-verify

`local-verify <pr | sha>` refuses to run (exit 3) unless the ticketflow runtime in the checkout (scripts, lib and
`.ticketflow/config.json`, untracked files included) equals `origin/<default_branch>`, so a pull request cannot
widen or neuter its own fallback. That holds only when you run the default branch's copy of the script. The
verify runs the code under test as you, with your `HOME` (git credentials, SSH keys) and a shared `.git`: it is a
clean environment, not a sandbox, so run only branches you would run anyway. A failed run is posted as a `failure`
status; a timeout posts nothing. A passing default-branch commit moves `deploy_branch` with a plain push (never
forced; a push rejected as non-fast-forward leaves the branch where it is, any other push error exits 1).

## gen-stubs

`gen-stubs <canonical-dir> <target-repo> [--check]` writes the agent stubs from the canonical `skills/<n>/SKILL.md` and
`agents/<n>.md` (`.ticketflow/` in a repo, `core/` in ticketflow itself) for the agents in `agents`. A stub is a thin file
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
`core/templates/`. `<templates-dir>` is `core/templates` in the ticketflow repo itself (the runtime is then `core/`) and any other
directory for a user repo (the runtime is `.ticketflow/`).

A managed block is delimited by `# ticketflow:begin <part>` and `# ticketflow:end <part>` (in Markdown: `<!-- ... -->`), each on its
own line. Render replaces the block of a part and leaves every other byte of the file alone, so the text between and around the blocks
(the `repo section`: your own CI steps, extra form fields, a top-level `env`) is yours. A file that exists without markers, or that
lacks a part render now wants, is a **conflict**: nothing is written (exit 1) and the file is listed; `--propose <dir>` writes the
suggested file for each conflict to `<dir>` (outside the target) to compare. A part that render no longer produces (the `deploy` job
once `deploy_branch` is `null`) is removed. Settings and hook files are merged by entry: your own entries stay, ticketflow's are added
(or, for the hook, replaced). `--keep <path>` leaves one rendered file alone (it is neither written nor checked). `--check` writes
nothing and exits 1 on drift. Exit 2: config or template error.

The install and verify steps are written into `ci.yml` only when the file is created (they are the repo section): later edits of
`verify.install` or `verify.command` do not reach it, and `--check` does not flag that. `gate.context` and `gate.check` accept letters, digits,
spaces and `. / : ( ) # + @ & -`; `verify.install` and `verify.command` accept no control character, lone CR, unicode line break (U+0085, U+2028, U+2029) or `${{`; an area is not `None` (issue forms reserve it) and has no surrounding spaces. A file with a
CRLF marker line merges (the managed block is rewritten with LF). Invalid JSON in a settings or hooks file is a conflict.

In the CI workflow the status `gate.context` is posted by the last step of the job named `gate.check`, on the head commit. The scope
step sets `skip=true` and a `description` (see the gate description contract above) for a docs-only or inherited pull request; every
step of the repo section must carry `if: steps.scope.outputs.skip != 'true'`, and a failed scope step means a full run.
