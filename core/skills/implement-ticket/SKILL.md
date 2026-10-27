---
name: implement-ticket
description: Use when asked to implement, continue or fix a GitHub ticket ("implement #N", "the next ticket", "next child of #T"), before any branch, commit, PR, merge or status change for it.
---

# Implement a ticket

- Read `.ticketflow/custom/implement-ticket.md` first if it exists: it adds to and overrides this file. Read `.ticketflow/config.json` once.
- Actions (dispatch a role, ask the user, run in the background) are done as the action map your stub names says; without one, use `.ticketflow/agents-map/generic.md`.
- For ticket work this skill replaces brainstorming, writing-plans, subagent-driven-development and executing-plans. Systematic-debugging, test-driven-development and verification-before-completion still apply when installed. Ask the user only about material decisions.

## 1. Read and claim

- **Ticket:** the one named, or the first open child from `node .ticketflow/scripts/tracker-next.mjs <T>`. "The next" is exactly one ticket, "all" is one after another; if unclear, ask.
- **Read** it with `node .ticketflow/scripts/issue.mjs <N>`, plus its linked plans and the docs it names. Later comments override the description. A statement about behaviour ("the job starts by itself") is checked in the code, never reinterpreted.
- **Readiness gate:** scope, acceptance criteria and verification must be coherent and checkable against the code. A material gap (a decision, a criterion you cannot verify, an unmerged dependency): ask one targeted question; with a recommended default, set `Needs: Decision`, say so on the ticket and continue other unblocked work. A non-material gap: state your assumption in the claim comment.
- **Claim:** `gh issue edit <N> --add-assignee @me`; when `project` is set in the config, `node .ticketflow/scripts/project.mjs status <N> "In Progress"`; a claim comment (`gh issue comment <N> --body-file -`, heredoc) with the tier, the assumptions and exactly one `Planning:` line (step 2).
- **Workspace:** `git fetch origin` every time, then `git worktree add --no-track <worktrees_dir>/<branch> -b <type>/issue-<N>-<slug> origin/<default_branch>`, then `verify.install` there. Edit and test in the worktree; run `pr-wait`, `merge` and `local-verify` with the up-to-date primary checkout as the working directory (`git -C <primary> pull --ff-only` first), so a branch never gates itself.

## 2. Route

**Plan by default:** dispatch the `ticket-planner` role. Skip only when all four hold, judged from the code you read:
- (a) you understand the whole change end to end, no design choice left;
- (b) a small diff in one place, roughly under 4 files, nothing cross-cutting;
- (c) no boot, deploy or config change, auth, permission or admin grant, data or schema change, money, concurrency or startup gate, and no second subsystem;
- (d) verification is obvious and automated.

Effort and complexity decide, not the tier or the length of the description. A ticket that reads like a plan is input to verify. Any doubt, or moderate or high effort: plan. When torn, plan.

**Planned earlier** means the ticket's `Planning:` line links a committed plan file. Model or effort text, "plan ready" or a detailed description never counts. A linked plan is still re-verified: by the planner, or by you only when its files are unchanged since its sha (`git diff <sha>..origin/<default_branch> -- <files>` is empty) and (a)-(d) hold.

**State exactly one `Planning:` line**, in the claim comment and in the ticket's Execution section (edit both), one reason per test when skipping:
- `Planning: planner (strong class, effort X)`, plus the plan's path once committed
- `Planning: planned earlier: <path>, re-verified because ... by <planner | main session: files unchanged since <sha>, (a)-(d) hold>`
- `Planning: skipped, easy and straightforward because: (a) ... (b) ... (c) ... (d) ...`

**Tier** (review depth and an effort floor only; classify up when unsure; the ticket's Execution section can raise it, never lower it):
- `low`: copy, docs or config value in one file.
- `normal`: logic in one subsystem, already tested.
- `high`: auth, permissions, grants or row-level rules; billing or money; data deletion or migrations that rewrite rows; locks, queues, transactions, idempotency, webhooks or async jobs; legal, consent or kids' data; external write integrations; production boot, deploy scripts or config, admin grants or startup gates; scripts, config, deploy and docs together; three or more subsystems or about 8 files; an ambiguous or conflicting spec.
- `critical`: high plus data exposure or loss, money movement, irreversible data operations, or production config.

A skipped plan whose diff grows past its stated scope is re-tiered up. **Effort:** high by default; floor high for `high`, xhigh for `critical`; xhigh also for genuinely hard work. If you run below the floor, switch model or effort (action map) before going on.

**Planner:** dispatch the `ticket-planner` role with a compact brief (ticket number, decisions made, guides and files you know; no transcripts). Commit its output on the ticket branch (create the worktree first) as `<plans_dir>/YYYY-MM-DD-issue-<N>-<slug>-technical.md` (`docs: technical plan (#<N>)`), link it from the ticket and put the path in the `Planning:` line. Its Open decisions go to the user, never assumed; continue what is not blocked. Hidden complexity later: escalate that problem alone, do not re-plan the ticket.

## 3. Implement, in this session

One context, one conventional commit per task, `Refs #<N>` in the body, never a closing keyword. Delegate only when it pays:

| Need | Action |
|---|---|
| Broad read-only search | dispatch a light helper |
| A hard, isolated piece (a lock order, a money state machine, a migration) | dispatch a strong helper with a compact brief; do not edit its files meanwhile |
| The same failure after two attempts | dispatch the `ticket-planner` role for a diagnosis |

Never delegate a deterministic command, a lookup, or one small task.

**Scope discipline:** a problem found while working that is related (caused or exposed by the ticket, same flow or files) and small is fixed in this PR, tested, and listed as "Also fixed". The same holds for every finding of a reviewer, CI, a smoke check or a delegated agent: fix it, or reject it with the reason; never leave an unticketed gap. Only a big (its own plan or tier, another subsystem, needs a decision) or unrelated problem gets its own issue (create-ticket skill), linked from this one. If fixing is cheaper than writing the issue, fix. Partial delivery: the rest gets its own issue. Never commit secrets or env files. Put this rule in every brief.

Before the PR, turn each rule of the ticket and the guides into an invariant question ("can any unit exceed its budget?") and sweep the whole diff for it.

**Parallel tickets** only when independent: disjoint files, no tracker order, no schema or shared state. You claim each ticket, create its worktree and branch, plan it and commit the plan; then dispatch one standard worker per ticket, in that worktree: "follow `.ticketflow/skills/implement-ticket/SKILL.md` step 3 with this plan, run the focused checks, open the PR (step 5, items 1-2), do not run live checks, review, wait or merge; report in at most 12 lines". You run the live checks, the reviews, the waits and the merges, one ticket at a time.

## 4. Verify

- `ci` mode: run focused checks while working; the gate status on the head is the full verification.
- `local-first` mode: run `verify.command` once after the last substantive change.
- Both modes: a UI, navigation or flow change is proven live (dispatch the `e2e-verifier` role when `live_verify_skill` is set; otherwise check it yourself).
- Never claim a check that did not run. One that cannot run becomes a deferred row (post-merge.md).

## 5. Pull request and review

1. Stage explicit paths (never everything), push.
2. `gh pr create` from the template, starting `Ticket #<N>`. `ci` mode: ready. `local-first` mode: `--draft` if the local checks have not all passed yet, then `gh pr ready <PR>` when they have (CI starts then).
3. Reviewers. None configured: dispatch the `pr-reviewer` role when the PR opens (effort: low tier medium; normal and high high; critical xhigh). Reviewers configured: `pr-reviewer` only for `high` and `critical`.
4. Wait once, in the background, with the primary checkout as the working directory: `node .ticketflow/scripts/pr-wait.mjs <PR>`. Its exit code decides:
   - 0: read its `Review:` and `Unresolved threads:` lines. `done`, `Unresolved threads: 0` and no open finding in a reviewer report: step 6; `changes requested (...)`, any listed thread or `unknown` (read the threads on the PR), or an open finding: the fix round (item 5), then wait again. `standin needed (...)`: dispatch the `pr-reviewer` role in stand-in mode (say so in the brief), unless it already reviewed this head. `none configured`: the review from step 3 is the one; wait for its report. A report with findings: the fix round (item 5), then wait again; without: step 6.
   - 1: fix and push once, then wait again; when it prints a behind-the-base hint, `gh pr update-branch <PR>` first, then `git pull` in the worktree.
   - 2: a draft (`local-first`): if the local checks have passed, `gh pr ready <PR>`, then wait again; otherwise finish them first. Otherwise a timeout: `pr-wait.mjs <PR> --once`, then report.
   - 3: `git -C <primary checkout> pull --ff-only`, then, with the primary checkout as the working directory, `node .ticketflow/scripts/local-verify.mjs <PR>`. Its exit 0: wait again. 1: a failure was posted, or nothing was (head moved, behind, timeout): read the output, fix or update, push, wait again. 2 or 3: report it.
5. Fix round: batch every finding (the threads pr-wait lists and the reviewers' reports) and sweep each class; push once; post a reviewer's `rereview_comment` only after substantive fixes; answer every listed thread with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (reply on stdin: the fix commit, or the reason for rejecting it), which also resolves it; `merge` refuses any unresolved thread, from any author. A fix to behaviour, tests, config or SQL gets one more `pr-reviewer` pass; a trivial one does not.

## 6. Merge

- If pr-wait printed `standin needed` or `none configured`, post a basis comment first: `gh pr comment <PR> --body-file -`, text `Review basis for <sha7>: <why>, reviewed by pr-reviewer <review URL (.../pull/<PR>#pullrequestreview-<id>)>; since then: <trivial fixes or none>`. The linked review must be the newest `pr-reviewer` review, say exactly `**Verdict:** ready to merge` and be of the head or an ancestor of it; after a force-push review again. Only an owner, member or collaborator account's comment and review count. Its id is in the printed `#issuecomment-<id>`. When the owner decided instead, the text is `Review basis for <sha7>: owner approved <what>`.
- Then, with the primary checkout as the working directory, `node .ticketflow/scripts/merge.mjs <PR> [--review-basis <id>]`. On exit 1 do what it prints (unresolved threads, changes requested, a `changes needed` verdict, a basis it does not accept). Merge no other way and never use the admin bypass; when the gates pass, merge without asking, except when the only review was an inline `pr-reviewer` (generic action map): then ask the user first.

## 7. After the merge

Read `.ticketflow/skills/implement-ticket/post-merge.md`.

**Background hygiene:** only bounded waits; no `pgrep -f` loops (they match themselves); kill what you started; never report while a wait is running.

**Stop and ask when** a material decision comes up, an unanticipated schema or live-data change is needed, the acceptance criteria conflict with the code, or verification cannot run.
