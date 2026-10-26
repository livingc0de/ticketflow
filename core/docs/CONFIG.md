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
| `default_branch` | branch name | required | `inherit`, `local-verify`, `pr-wait` |
| `verify.mode` | `ci` or `local-first` | required | `pr-wait` (a draft in `local-first` is not CI-checked) |
| `verify.install` | string (shell) | `""` | `local-verify` |
| `verify.command` | non-empty string (shell) | required | `local-verify` |
| `verify.timeout_min` | integer 1..360 | `45` | `local-verify` |
| `gate.context` | string: the commit status that is the merge gate | `"ci/gate"` | `inherit`, `pr-wait`, `local-verify` |
| `gate.check` | string: the Actions job (check run) behind the gate | `"Verify"` | `pr-wait` |
| `gate.inherit` | boolean | `false` | `local-verify` (and CI: call `inherit.mjs`) |
| `gate.ci_files` | list of regexes | `[]` | `inherit` |
| `docs_only.docs` | list of regexes: paths that are documentation | `[]` | `docs-only`, `inherit` |
| `docs_only.code` | list of regexes: paths that are code even if they match `docs` | `[]` | `docs-only`, `inherit` |
| `reviewers` | list of reviewer objects | `[]` | `pr-wait` |
| `deploy_branch` | branch name or `null`; must differ from `default_branch` | `null` | `local-verify` |

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
| `stale_after_min` | integer minutes after which a silent reviewer no longer blocks, or `null` | `null` |

Example login: `review-bot[bot]`.

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
