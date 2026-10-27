# CI gate

The merge gate is one commit status on the pull request's head commit, named by `gate.context` (default `CI / Gate`).
The verdict is that status alone; `merge`, `pr-wait` and the branch ruleset all read it. Config keys: [CONFIG.md](CONFIG.md).

## Status, not check

- The verdict is the **status** `gate.context`. The job that runs the work is a **check** named `gate.check` (default `Verify`).
  The two names must differ: a check and a status with one name would both be required.
- A status can be posted by the CI job or, when Actions refuses to run the job, by `local-verify`; a check run can only come
  from Actions. Check runs are read only to tell a refused run from a real red one.
- The rendered workflow posts the status in the last step of the job, on the head commit (never the test merge commit), with
  `if: always()`, so a timeout or a cancel posts a failure too.
- Every run, docs-only or not, first checks the agent stubs (`gen-stubs --check`, the head's own copy): a stale or hand-edited stub
  fails the gate. The local fallback does the same before its docs-only result or its verify command.
- Verify mode (`ci` or `local-first`) is described in [WORKFLOW.md](WORKFLOW.md).

## Description contract

Whatever posts the status writes one of these descriptions; `inherit` and `pr-wait` read them.

- `Actions run #<run id>`: a full run by Actions. A failure with this description is final.
- `Actions run #<run id>, docs only`: Actions, docs-only diff.
- `Local run on <host> (<arch>, Node <version>)`: a full local run. A failure whose description starts with `Local ` can be re-run
  locally while Actions still refuses the job.
- `Local check on <host>, docs only`: local, docs-only diff.
- `Inherited from <sha7>: only docs merged from <default_branch>`: the result of the full run at `<sha7>`.

Only the first and third forms count as a full run to inherit from. GitHub shows at most 140 characters. An unrecognized
description is safe: `inherit` finds no full run (the pull request gets a normal one), and `pr-wait` reads a failure with it as final.

## Docs-only pull requests

`docs_only.docs` lists regexes for documentation paths, `docs_only.code` regexes for paths that are code even if they match.
A pull request is docs-only when every changed path matches `docs` and no code pattern. Anything unlisted, an empty list, a control
character in a name, or a config error is code: a doubt runs everything. Built-in floors (always code): [CONFIG.md](CONFIG.md).

In the workflow, the `scope` step decides this on the test merge commit. For a docs-only pull request it sets `skip=true` and a
description; the repo section's steps (every one carries `if: steps.scope.outputs.skip != 'true'`) are skipped, and the last step posts
`success` with the docs-only description. A failed scope step means a full run.

## Inheritance

With `gate.inherit: true`, a pull request that is only updated with the default branch (`gh pr update-branch`: one merge, parents
`[previous head, default branch]`) keeps its green result when everything merged in is docs-only, instead of a new full run. The
previous head (or the full run an earlier `Inherited from` status points to) must hold a full-run `success`, and every change since
must be docs-only. Never inherited: a pull request that changes a CI file (the built-in floor in [CONFIG.md](CONFIG.md) plus
`gate.ci_files`), more than 20 incoming default-branch commits, or 300 or more files in a diff. Any failed read, or a head or base
that moved while reading, is a normal run. The check reads only through `gh api`, as data, and nothing from the
pull request is installed or run for it.

## Local fallback

When Actions refuses the job (a billing annotation on a run with no steps, or a job queued 20 minutes without a runner), `pr-wait`
exits 3 and prints `Fallback: allowed`. Then, by hand and never by a timer, `local-verify <pr | sha>` runs `verify.command` in a
clean worktree of the exact, up-to-date head and posts the result as the status (and one comment on a pull request).

- Fail-closed: nothing is posted unless `pr-wait <target> --once --ci-only` exits 3 both before and right after the run, on the same
  head. A timeout, a moved head, a head behind the default branch (it runs `gh pr update-branch` and stops) or any doubt posts nothing.
- Exit 3 (refused): the fallback is not allowed, a fork, another base, or the runtime in the checkout differs from
  `origin/<default_branch>` (scripts, lib and `.ticketflow/config.json`, untracked files included), so a pull request cannot widen
  or neuter its own fallback. Run the default branch's copy of the script.
- A failure is posted too, so the gate is red at once. A red that got a runner on Actions is never replaced.
- For a pull request it first tries to inherit (with `gate.inherit`), then a docs-only `Local check`, otherwise it runs the verify. A bare sha always gets a full run.
- A passing default-branch commit moves `deploy_branch` (when set) with a plain push, never forced. A push rejected as
  non-fast-forward leaves the branch where it is; any other push error exits 1. The workflow's `Advance Deploy Branch` job does the
  same when Actions runs. `ci.push_paths` must be `null` or `[]` while `deploy_branch` is set.

## Security notes

- The workflow checks out with `persist-credentials: false`; only the scope step and the last step get a token, so no install script
  or test can post the gate itself. A pull request that edits the workflow or the runtime runs its own copy of the scope step: review
  is the control.
- `local-verify` runs the code under test as you, in a clean environment (`HOME`, `PATH` and `CI=true` only) with a shared `.git`:
  it is not a sandbox. Run only branches you would run anyway.
- A hand-posted status forges the gate: the agent guard asks or blocks it ([SECURITY.md](SECURITY.md)).
