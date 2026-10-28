---
name: implement-ticket
description: Use when asked to implement, continue or fix a GitHub ticket ("implement #N", "the next ticket", "next child of #T"), before any branch, commit, PR, merge or status change for it.
---

# Implement a ticket

- Read `.ticketflow/custom/implement-ticket.md` first if it exists: it adds to and overrides this file. Read `.ticketflow/config.json` once.
- Actions (dispatch a role, ask the user, run in the background) are done as the action map your stub names says; without one, use `.ticketflow/agents-map/generic.md`.
- This skill is the whole flow for ticket work. How the work is done (the plan-or-skip tests, test first, debugging, the smallest change, delegation, evidence before claims, and no other plugin's flow on top) is `.ticketflow/skills/engineering-method/SKILL.md`; read it before step 2.

## 1. Read and claim

- **Ticket:** the one named, or the first open child from `node .ticketflow/scripts/tracker-next.mjs <T>`. "The next" is exactly one ticket; "all" or a list of tickets goes to `orchestrate-tickets`; if unclear, ask.
- **Read** it with `node .ticketflow/scripts/issue.mjs <N>`, plus its linked plans and the docs it names. Later comments override the description. A statement about behaviour ("the job starts by itself") is checked in the code, never reinterpreted.
- **Readiness gate:** scope, acceptance criteria and verification must be coherent and checkable against the code. A material gap (a decision, a criterion you cannot verify, an unmerged dependency): ask one targeted question; with a recommended default, set `Needs: Decision`, say so on the ticket and continue other unblocked work. A non-material gap: state your assumption in the claim comment.
- **Already started:** `node .ticketflow/scripts/queue.mjs <N>` shows an open PR (a closed one is history), `merged` or `done`: this replaces Claim and Workspace. Reuse the PR's worktree or branch (never a second claim comment, worktree add or PR) and continue from the PR; `merged`: step 7 only, skipping what is done, never repeating a deploy or migration step. For a continue or resume request (an orchestrator lead, "continue #N"), `done` with a merged PR means nothing to build and never a second PR: without a project, step 7 only when its summary comment is missing, otherwise stop and report. An owner's explicit request to change an In Review ticket is a new change in the running ticket, as before. `in-progress` with no PR (a crash after the claim): reuse the branch and worktree that match `issue-<N>-` (`git ls-remote --heads origin`, `git worktree list`) and the claim comment; never a second claim, branch or worktree.
- **Claim:** `gh issue edit <N> --add-assignee @me`; when `project` is set in the config, `node .ticketflow/scripts/project.mjs status <N> "In Progress"`; a claim comment (`gh issue comment <N> --body-file -`, heredoc) with the tier, the assumptions and exactly one `Planning:` line (step 2).
- **Workspace:** `git fetch origin` every time, then `git worktree add --no-track <worktrees_dir>/<branch> -b <type>/issue-<N>-<slug> origin/<default_branch>`, then `verify.install` there. Edit and test in the worktree; run `pr-wait`, `merge` and `local-verify` with the up-to-date primary checkout as the working directory (`git -C <primary> pull --ff-only` first), so a branch never gates itself.

## 2. Route

**Plan by default:** dispatch the `ticket-planner` role. Skip only when the four tests (a)-(d) of `.ticketflow/skills/engineering-method/SKILL.md` section 1 all hold, judged from the code you read. The tier and the length of the description do not decide, and a ticket that reads like a plan is input to verify.

**Planned earlier** means the ticket's `Planning:` line links a committed plan file. Model or effort text, "plan ready" or a detailed description never counts. A linked plan is still re-verified: by the planner, or by you only when its files are unchanged since its sha (`git diff <sha>..origin/<default_branch> -- <files>` is empty) and (a)-(d) hold.

**State exactly one `Planning:` line** in the claim comment (edit the ticket's Execution section only if it says otherwise), one reason per test when skipping:
- `Planning: planner (strong class, effort X)`, plus the plan's path once committed
- `Planning: planned earlier: <path>, re-verified because ... by <planner | main session: files unchanged since <sha>, (a)-(d) hold>`
- `Planning: skipped, easy and straightforward because: (a) ... (b) ... (c) ... (d) ...`

**Tier** (review depth and verification only; classify up when unsure; the ticket's Execution section can raise it, never lower it):
- `low`: copy, docs or config value in one file.
- `normal`: logic in one subsystem, already tested.
- `high`: auth, permissions, grants or row-level rules; billing or money; data deletion or migrations that rewrite rows; locks, queues, transactions, idempotency, webhooks or async jobs; legal, consent or kids' data; external write integrations; production boot, deploy scripts or config, admin grants or startup gates; scripts, config, deploy and docs together; three or more subsystems or about 8 files; an ambiguous or conflicting spec.
- `critical`: high plus data exposure or loss, money movement, irreversible data operations, or production config.

A skipped plan whose diff grows past its stated scope is re-tiered up and gets the planner for the rest. **Implementer:** the standard class at high by default; the strong class or xhigh only for genuinely hard reasoning, never because of the tier, which sets review depth and verification, not your model or effort.

**Planner:** dispatch the `ticket-planner` role with a compact brief (ticket number, decisions made, guides and files you know; no transcripts). Commit its output on the ticket branch (create the worktree first) as `<plans_dir>/YYYY-MM-DD-issue-<N>-<slug>-technical.md` (`docs: technical plan (#<N>)`), link it from the ticket and put the path in the `Planning:` line. Its Open decisions go to the user, never assumed; continue what is not blocked. Hidden complexity later: escalate that problem alone, do not re-plan the ticket.

## 3. Implement, in this session

One context, one conventional commit per task, `Refs #<N>` in the body, never a closing keyword. Work as the engineering-method skill says (test first, debugging, the smallest change, delegation). A deviation from the plan gets one line in the PR's Review Notes.

**Scope discipline:** a problem found while working that is related (caused or exposed by the ticket, same flow or files) and small is fixed in this PR, tested, and listed as "Also fixed". The same holds for every finding of a reviewer, CI, a smoke check or a delegated agent: fix it, or reject it with the reason; never leave an unticketed gap. Only a big (its own plan or tier, another subsystem, needs a decision) or unrelated problem gets its own issue (create-ticket skill), linked from this one. If fixing is cheaper than writing the issue, fix. Partial delivery: the rest gets its own issue. Never commit secrets or env files. Put this rule in every brief.

**Several tickets** in one run: `orchestrate-tickets`. This skill is for one ticket.

## 4. Verify

- `ci` mode: run focused checks while working; the gate status on the head is the full verification.
- `local-first` mode: run `verify.command` once after the last substantive change.
- Both modes: a UI, navigation or flow change is proven live (dispatch the `e2e-verifier` role when `live_verify_skill` is set; otherwise check it yourself).
- A check that cannot run becomes a deferred row (post-merge.md), never a claim.

## 5. Pull request and review

1. Stage explicit paths (never everything), push.
2. Run `node .ticketflow/scripts/queue.mjs <N>` again first: an open PR on another branch means another session got there first, so stop and report. Then `gh pr create` from the template, starting `Ticket #<N>`. `ci` mode: ready. `local-first` mode: `--draft` if the local checks have not all passed yet, then `gh pr ready <PR>` when they have (CI starts then).
3. Wait once, in the background, with the primary checkout as the working directory: `node .ticketflow/scripts/pr-wait.mjs <PR>`. While CI runs it watches the head for review bots or people that start (a reaction, a comment, a review) and waits for each one's result, at most 15 minutes from its start. Its exit code decides:
   - 0: read its `Review:` and `Unresolved threads:` lines. `results (<logins>)`: read each result (the link on its `Review <login>:` line) and fix or answer every finding (item 5); one that says more is coming: wait again with `--more '<login>'`; an error, quota or status note is no result. `none` or no usable result: dispatch `pr-reviewer` now (effort: low tier medium; normal and high high; critical xhigh). After an external result `pr-reviewer` also runs on `critical`, when the ticket or the owner asks, and on `high` only where the result does not cover the risky part (auth, money or migration logic it never discussed), never for the tier alone. `changes requested (...)`, a listed thread or `unknown`: the fix round (item 5), then wait again.
   - 1: fix and push once, then wait again (never review a red head); when it prints a behind-the-base hint, `gh pr update-branch <PR>` first, then `git pull` in the worktree.
   - 2: a draft (`local-first`): `gh pr ready <PR>` once the local checks have passed (finish them first otherwise), then wait again. Otherwise a timeout: `pr-wait.mjs <PR> --once`, then report.
   - 3: `git -C <primary checkout> pull --ff-only`, then, with the primary checkout as the working directory, `node .ticketflow/scripts/local-verify.mjs <PR>`. Its exit 0: wait again. 1: a failure was posted, or nothing was (head moved, behind, timeout): read the output, fix or update, push, wait again. 2 or 3: report it.
4. `pr-reviewer` reports every finding to you: act on that report; its posted review is merge's record. Brief it with the previous reviewed head: it reviews the delta plus what it touches. A review someone else dispatched (an orchestrator) is read from the PR.
5. Fix round: batch every finding (threads, external results, reports) and sweep each class; push once; answer every listed thread with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (reply on stdin: the fix commit, or the reason for rejecting it), which also resolves it; `merge` refuses any unresolved thread, from any author. A push starts a new cycle: wait again, and the new head needs its own review (an external result on it, or a `pr-reviewer` delta review). A security, data or correctness finding rejected without a fix gets a `pr-reviewer` pass on the head, with the finding in the brief.

## 6. Merge

With the primary checkout as the working directory: `node .ticketflow/scripts/merge.mjs <PR>` when `pr-reviewer`'s ready verdict on the head is the review, or `merge.mjs <PR> --reviewed-by '<login>'` (quote a `[bot]` login) when an external reviewer's result on the head is the one you acted on. On exit 1 do what it prints. Merge no other way and never use the admin bypass; when the gates pass, merge without asking, except when the only review was an inline `pr-reviewer` (generic action map): then ask the user first.

## 7. After the merge

Read `.ticketflow/skills/implement-ticket/post-merge.md`.

**Background hygiene:** only bounded waits; no `pgrep -f` loops (they match themselves); kill what you started; never report while a wait is running.

**Stop and ask when** a material decision comes up, an unanticipated schema or live-data change is needed, the acceptance criteria conflict with the code, or verification cannot run.
