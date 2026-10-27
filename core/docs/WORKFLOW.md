# Workflow

This is the heart of TicketFlow: how a piece of work travels from an idea to merged code, and why each step exists. Agents follow
the same rules step by step through the `implement-ticket` and `create-ticket` skills; this page explains them for people, in one
place. For what the board statuses and labels mean, see [PROJECT.md](PROJECT.md).

**The short version:** every change starts as a ticket, is planned unless it is small and obvious, is built on its own branch,
proves itself with a green gate, gets an independent review, merges only through a script that checks all of that, and comes back
to you as In Review with a summary. You decide when it is Done.

## Lifecycle

ticket, plan, implement, verify, review, merge, handoff.

1. **Ticket.** One issue is one shippable unit that one pull request can complete; anything bigger is a `Type: Initiative` tracker
   with children. Every ticket has an Execution section with a recommended tier, model and effort, and planning route.
2. **Claim.** Assign, set the status to In Progress, post a claim comment with the tier, the assumptions and one `Planning:` line.
   Work happens in a git worktree on a `<type>/issue-<N>-<slug>` branch from the up-to-date default branch.
3. **Plan** (below), **implement** in one context with one conventional commit per task, `verify`, open the pull request.
4. **Review** (below), then **merge** only through `merge`, which checks every gate on the exact head, then merges with a method the
   repo allows (squash first; `protect --squash-only` makes it the only one, on the owner's choice).
5. **Handoff.** Status In Review, the issue stays open, and a summary comment ends with the Run line. Done only when the owner asks.

Pull requests and commits say `Ticket #N` or `Refs #N`, never a closing keyword (Closes, Fixes, Resolves): nothing may close or
move the issue on merge.

## Risk tiers

A tier sets review depth and an effort floor, nothing else. Classify up when unsure; a ticket's recommendation can raise a tier,
never lower it. The `implement-ticket` skill holds the full definitions; in short:

- `low`: copy, docs or a config value in one file.
- `normal`: logic in one subsystem, already tested.
- `high`: anything touching access, money, data migrations, concurrency or async work, legal or consent, external writes,
  production boot or deploy config, an ambiguous spec, or three or more subsystems.
- `critical`: `high` plus data exposure or loss, money movement, irreversible data operations, or production config.

Effort is `high` by default, with floor `high` for the `high` tier and `xhigh` for `critical`; `xhigh` also for genuinely hard work.
A skipped plan whose diff grows past its stated scope is re-tiered up.

## Planning

**Plan by default**: the `ticket-planner` role writes the plan. Skip only when all four tests hold, judged from the code:

- (a) you understand the whole change end to end, no design choice left;
- (b) a small diff in one place, roughly under 4 files, nothing cross-cutting;
- (c) no boot, deploy or config change, auth, permission or admin grant, data or schema change, money, concurrency or startup gate,
  and no second subsystem;
- (d) verification is obvious and automated.

Effort and complexity decide, not the tier or the length of the description. A ticket that reads like a plan is input to verify.
Any doubt: plan.

A ticket counts as **planned** only when its `Planning:` line links a plan file under `plans_dir`
(`YYYY-MM-DD-issue-<N>-<slug>-technical.md`) that is committed to the repo and written by the `ticket-planner` role. Model or
effort text, "plan ready" or a detailed description never counts. A linked plan is re-verified against the current code before use.
The plan ends with `Verified against <sha> on <date>`; its open decisions go to the owner, never assumed.

Exactly one `Planning:` line, in the claim comment and the ticket (formats in the skill); a skip gives one reason per test.

## Verify

`verify.mode` in the config:

- **`ci`**: run focused checks while working; the gate status on the head is the full verification.
- **`local-first`**: run `verify.command` locally once after the last substantive change. Open the pull request as a draft until the
  local checks pass (CI skips drafts), then mark it ready, which starts CI.

In both modes a UI, navigation or flow change is proven live (the `e2e-verifier` role, when `live_verify_skill` is set). A check that
cannot run is never claimed: it goes in the `deferred_checks_issue` (when set) or the summary under "Not verified".
The gate itself: [CI-GATE.md](CI-GATE.md).

## Review

The `pr-reviewer` role is always available and is never listed in `reviewers`. With no external reviewer configured, it reviews
every pull request; with one configured, it reviews `high` and `critical` pull requests, and stands in when the configured reviewer
is unavailable or silent. Its effort follows the tier (the skill sets it). It posts one review
comment, never approves, never edits. A fix to behaviour, tests, config or SQL gets one more pass; a trivial fix does not.
External reviewers and the stand-in rules: [REVIEWERS.md](REVIEWERS.md).

Wait once, in the background (`pr-wait`), batch every finding into one push, and fix or reject each with a reason; reply to and resolve
each review thread with `thread.mjs`. A related small
problem found along the way is fixed in the same pull request and listed as "Also fixed"; only a big or unrelated one gets its own issue.

## Merge

`merge <PR>` is the only way. It requires, on the exact head: the pull request open, not a draft, based on the default branch; the
gate status `success`; the head contains the default branch; no unresolved review thread (any author); the review gate done and not
`changes requested` (a reviewer's answer, or a `--review-basis` comment `Review basis for <sha7>: ...` that links a `ready to merge`
`pr-reviewer` review of this PR, or says `owner approved`, when `pr-wait` printed `standin needed` or `none configured`); and the last
`pr-reviewer` review of the head saying exactly `ready to merge` (owner, member or collaborator accounts only). What that proves, what
stays convention and what cannot be verified: [REVIEWERS.md](REVIEWERS.md). It merges (squash, else rebase, else a merge commit, as the repo allows) with
`--match-head-commit`. When the gates pass, merge without asking, except when the only review was an inline `pr-reviewer`
(no sub-agents): ask the owner. Never `--admin`, never `--auto`; see [SECURITY.md](SECURITY.md).

## Handoff and the Run line

After the merge: status In Review, a summary comment (what merged, the evidence, decisions, assumptions, "Also fixed",
follow-ups, anything not verified), then clean up the worktree. The comment ends with:

`Run: tier <t> · main <model>/<effort> · planner <matches the Planning line> · reviewer <names | pr-reviewer/effort | none> · review rounds <n> · CI runs <n> · fallback <yes|no>`

It is how plan skips, review rounds and CI runs get measured ([TOKEN-BUDGET.md](TOKEN-BUDGET.md)). When `deploy_branch` is set,
watch the merge commit's CI too.

## Branching

Trunk-based. Pull request branches are short-lived and merge into the default branch; there is no long-lived `dev` branch.
Deploy only CI-green commits. Unfinished features ship behind settings flags, not on a branch. For production, promote the same
tested commit (a tag or release, or an environment approval) rather than adding a branch that diverges from the default branch.
