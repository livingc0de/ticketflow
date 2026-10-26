# Security model

What stops an agent from merging or pushing without the checks, what does not, and what was measured.

## Threat model

- **The gates** are the branch ruleset (`core/scripts/protect.mjs`) and the merge script (`core/scripts/merge.mjs`).
  The ruleset is enforced by GitHub, for everyone it applies to. The merge script checks, on the exact head, the gate status,
  that the branch is up to date and the review gate, then squash-merges with `--match-head-commit`.
- **The speed bumps** are the AGENTS rule, the Claude ask rules, the Codex prompt rules and the Codex hook (`core/guard.json`,
  rendered by `core/lib/guard.mjs`). They stop an agent that follows the rules and makes an honest mistake. They are not a boundary:
  `bash -c "..."` inside a script, a script file, `$(...)`, `git -C <dir> push`, `git -c k=v push`, a variable holding the command,
  an `env`, `command` or `sudo` prefix, a subshell, a line continuation, `gh pr -R o/r merge`, a path to `protect.mjs` that is not
  the relative one, a heredoc marker inside a multi-line quoted string (it hides the lines after it), or another tool all get past them. Writes to the default branch through the API (`git/refs`, `merges`,
  contents, GraphQL `mergeBranch` or `createCommitOnBranch`) are neither covered nor probed.
- **The bypass** exists on purpose: the repository admin may merge past the checks when the owner explicitly asks. An agent that
  runs with the owner's admin token has that right too. The ruleset therefore cannot stop an agent that uses the admin token for
  an API merge or `gh pr merge --admin` (see the table). Only the rules above, the ask/prompt rules and the owner's attention do.
- **The attestation** `--review-basis` is made by the agent. It is bound to the head sha but cannot prove that a reviewer ran.
- **Known ceiling:** a push to the base branch between the "up to date" check and the merge is not caught (the head is, through
  `--match-head-commit`). The window is seconds.

## Bypass modes

The standard ruleset has one bypass actor: the repository admin role (`actor_type: RepositoryRole`, `actor_id: 5`).
`BYPASS_MODE` in `core/lib/protect.mjs` is `pull_request`: the admin can merge a pull request past the checks, but nobody can push
to the default branch directly.

Probed on 2026-10-26 with gh 2.102.0 on a private, user-owned repository (squash only, ruleset with `deletion`, `non_fast_forward`,
`pull_request` and strict `ci/gate`, no `ci/gate` posted unless a row says so). Each cell is the result of one attempt on a fresh
one-commit pull request. "refused" means GitHub or gh refused and nothing changed.

| Attempt | `always` | `pull_request` (standard) | no bypass actor |
|---|---|---|---|
| `gh pr view --json mergeStateStatus` | BLOCKED | BLOCKED (UNKNOWN for a moment after the PR is created) | BLOCKED |
| `gh pr merge --squash` | refused by gh: "base branch policy prohibits the merge" | refused when the state is known; **merged** when sent before GitHub had computed the state | refused (same message) |
| API merge (`PUT pulls/N/merge`, squash) | **merged** | **merged** | refused (405, "Required status check ci/gate is expected") |
| `gh pr merge --squash --admin` | **merged** | **merged** | refused ("Repository rule violations found") |
| `git push origin HEAD:main` | **accepted** (the push output lists the bypassed rule) | refused ("push declined due to repository rule violations") | refused (same) |
| `git push --force origin <older commit>:main` | **accepted** (forced update) | refused (same) | refused (same) |
| `ci/gate` failure posted, `gh pr merge --squash` | refused | refused | not run |
| `ci/gate` failure posted, API merge | **merged** | **merged** | refused (405, "ci/gate is failing") |

Other facts from the same run:

- GitHub accepted the admin role id `5` as a `RepositoryRole` bypass actor on a private personal repository, in both modes, and
  returned it unchanged. `current_user_can_bypass` read `always` (mode `always`), `pull_requests_only` (mode `pull_request`) and
  `never` (no actor). `protect` expects the second.
- `protect --apply --migrate-classic` on a repository with classic protection created the ruleset, passed the read-back, then deleted
  the classic protection (`GET branches/<b>/protection` then returns 404). GitHub adds parameters of its own to a stored ruleset, so
  the read-back compares only what `protect` sets.
- A merge method other than squash is refused by the repository setting (405, "Merge commits are not allowed").
- `merge.mjs` refused with `ci/gate` missing, refused with the gate green but no reviewer and no `--review-basis`, and merged once
  the gate was `success` on the head and a comment naming the head's first 7 characters was passed as the basis.

What this means: `pull_request` closes direct pushes and force pushes for everyone, agents included, because GitHub enforces it.
It does not close merges, so the merge path stays behind the guard and the AGENTS rule. Use `always` only if direct pushes by the
owner are needed.

## Agent-side checks

- **Claude:** in a checkout with the rendered ask rules and a broad allow rule, the commands `gh pr merge 1 --admin`,
  `git push origin main` and `node .ticketflow/scripts/protect.mjs --apply` were each refused for permission (a trailing, a
  middle and a leading wildcard rule), while `gh pr view` and a push of a feature branch ran. So an ask rule beats an allow rule.
  Not verified: whether the ask rules still prompt under `bypassPermissions` (the check was not run), and the actual hook input of
  Codex (the guard handles a command string and an argv array).
- **Codex:** `codex execpolicy check` loads the generated rules and decides as the examples in `guard.json` say (tested when `codex`
  is on PATH). An end-to-end run with a trusted hook was not completed.

## Guard rules

- A form is **blocked** (Codex hook, exit 2) only when it has no legitimate agent use: API merges, hand-posted gate statuses,
  pushes to the default branch that no prefix rule can express, ruleset or protection writes. Everything else asks (Claude) or prompts
  (Codex), so an explicit request of the owner stays possible.
- Every block names the allowed path. Claude has no blocking hook, because it would also block the owner's explicit request.
- Both Codex rules and hooks load only in trusted projects, and a hook must be trusted once via `/hooks`, again after a change.
- `guard.mjs --self-test` checks every example in `guard.json` against the hook.
