# Technical plan: #18 Follow The Repository's Own Settings Instead Of Imposing Them

**Risk:** high (branch protection, the merge path, labels, the Project, render; about 25 files). Planned, independent review.

**Approach:** mostly deletion. Remove what TicketFlow imposes and keep only the safety model (one required `CI / Gate`, strict, merge
only through `merge.mjs`, no agent bypass, no closing keywords): the `SETTINGS` PATCH, the forced `allowed_merge_methods`, the bypass
actor added to someone else's ruleset, label updates, the forced Roadmap. Two small additions: `merge.mjs` picks a method the repo and
the branch rules allow; render keeps each managed job's existing `runs-on` (no new config key).

## Tasks

1. **Labels: core labels are create-only** (`core/scripts/labels.mjs` `wantedLabels()`: core entries get `createOnly: true`;
   `custom/labels.json` entries are still updated; `Area:` labels stay create-only). Tests: an existing core label that differs gets no
   write; a custom label that differs is PATCHed; the dry-run's pending update comes from a custom label.
2. **protect keeps the repo's settings, merge methods and bypass actors** (`core/lib/protect.mjs`: delete `SETTINGS`; the `pull_request`
   rule no longer forces `allowed_merge_methods`; an existing ruleset keeps its bypass actors (warn when it has no admin actor), a
   created one gets the admin actor in `pull_request` mode; `flat()` drops `settings.*`. `core/scripts/protect.mjs`: no repo PATCH; the
   read-back checks `current_user_can_bypass` only for a ruleset it created). Tests: fixtures without settings; an existing ruleset is
   left as is; a squash-only repo gives no diff and no PATCH; a created body has the admin actor and no `allowed_merge_methods`.
3. **merge.mjs uses a method the repo allows**: one GraphQL read of `squashMergeAllowed`/`rebaseMergeAllowed`/`mergeCommitAllowed`
   and the branch rules (`rules/branches/<base>`, which include org rulesets); the first of squash, rebase, merge that both allow;
   none: refuse. `--match-head-commit` and `--delete-branch` unchanged; output names the method. Tests for each path and a failed read.
4. **ci.yml `runs-on` follows the repo**: the two `runs-on:` lines become whole-line placeholders filled by `runsOn(existing, part)`
   in `renderFile` (the existing entry of that managed block, verbatim; default `ubuntu-latest`). Tests: fresh render, a self-hosted
   list and a mapping form re-render byte for byte, `--check` passes.
5. **Templates and the AGENTS block**: `ISSUE_TEMPLATE/config.yml` is kind `once` (no markers); the bug form's Environment dropdown is
   removed; the PR template line becomes "Visible changes verified live"; the AGENTS line drops "without asking" (it stays in the
   skill, which `custom/` can override); post-merge says "merge commit". Tests for each; re-render this repo.
6. **Project: Roadmap and the date fields are optional** (`VIEWS` gains Roadmap; the date fields only with Roadmap). Tests updated.
7. **Skills and docs**: interview (optional views none by default), existing-repo (`runs-on`), github.md (labels and protect only
   add), sync step 8, PROJECT, CONFIG, SECURITY, UPGRADING, WORKFLOW, README, CHANGELOG.

## Callers checked

`SETTINGS`/`CAN_BYPASS`: protect script and tests only. `doctor` runs labels/protect/project dry-runs (less drift, same exit codes).
`renderFile`: render script (computes `existing` first) and doctor (dest list). `gh pr update-branch` does not depend on
`allow_update_branch`; `merge --delete-branch` replaces `delete_branch_on_merge`. The guard asks on every `gh pr merge` form.

## Fail-closed

merge: a failed method read or no allowed method: exit 1, no merge call. protect: admin needed for `--apply`, broad or multiple
rulesets refused, read-back diff mandatory. render: malformed markers still throw.

## Open decision

An existing admin bypass actor in mode `always`: keep it as the repo set it (recommended default, applied) or tighten it to
`pull_request`. Asked of the owner.

Verified against 92f49c675d69bd4542b723093d6338c94afe13cb on 2026-10-27 (ticket-planner, Opus, high).
