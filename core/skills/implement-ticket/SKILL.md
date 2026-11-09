---
name: implement-ticket
description: Use when asked to implement, continue or fix a GitHub ticket ("implement #N", "the next ticket", "next child of #T"), before any branch, commit, PR, merge or status change for it.
---

# Implement a ticket

- This skill is the whole flow for ticket work. Actions (dispatch a role, ask the user, wait for a script) are done as the action map your stub names says (`.ticketflow/agents-map/generic.md` without one). How the work is done (planner triggers, test first, debugging, the smallest change, delegation, evidence before claims, no other plugin's flow on top) is `.ticketflow/skills/engineering-method/SKILL.md`; read it before step 2.
- `.ticketflow/custom/implement-ticket.md` adds to and overrides this skill, and `.ticketflow/custom/<name>.md` the part, role or doc of that name; read one only when the step 1 call listed it.

## 1. Read and claim

- **Ticket:** the one named, or the first open child from `node .ticketflow/scripts/tracker-next.mjs <T>`. "The next" is one ticket; "all" or a list goes to `orchestrate-tickets`; if unclear, ask.
- **First call, batched:** `node .ticketflow/scripts/issue.mjs <N>; node .ticketflow/scripts/queue.mjs <N>; cat .ticketflow/config.json; ls .ticketflow/custom`, then its linked plans and the docs it names. Later comments override the description. A statement about behaviour is checked in the code, never reinterpreted.
- **Readiness gate:** scope, acceptance criteria and verification must be coherent and checkable against the code. A material gap (a decision, a criterion you cannot verify, an unmerged dependency): ask one targeted question; with a recommended default, set `Needs: Decision`, say so on the ticket and continue other unblocked work. A non-material gap: state your assumption in the claim comment.
- **Already started:** `queue` shows an open PR (a closed one is history), `merged`, `done`, or `in-progress` with no PR (a crash after the claim): read `.ticketflow/skills/implement-ticket/resume.md`, which replaces Claim and Workspace. Never a second claim comment, worktree add or PR.
- **Claim:** `node .ticketflow/scripts/ticket.mjs claim <N>` with the comment on stdin (heredoc, about 10 lines): the tier, the assumptions and exactly one `Planning:` line (step 2). It assigns you, sets "In Progress" when `project` is set and posts once (a repeat keeps the existing comment and says when your text differs).
- **Workspace:** `node .ticketflow/scripts/workspace.mjs <type>/issue-<N>-<slug>` (one call: fetch, ignore the worktrees dir, `git worktree add --no-track` from `origin/<default_branch>`, `verify.install`; it refuses a branch or directory that exists; a layout it cannot handle: the same steps by hand). Edit and test in the worktree; run `pr-wait`, `merge` and `local-verify` from the up-to-date primary checkout (`git -C <primary> pull --ff-only` first), so a branch never gates itself.

## 2. Route

**The tier sets the process** (`.ticketflow/docs/WORKFLOW.md` Risk tiers). Classify up when unsure; labels do not lower it. Classify by what a wrong change could break, not where the code lives:
- `low`: copy, docs or config value in one file.
- `normal`: logic in one subsystem, already tested.
- `high`: auth, permissions, grants or row-level rules; billing or money; data deletion or migrations that rewrite rows; locks, queues, transactions, idempotency, webhooks or async jobs; legal, consent or kids' data; external write integrations; production boot, deploy scripts or config, admin grants or startup gates; scripts, config, deploy and docs together; three or more subsystems or about 8 files; an ambiguous or conflicting spec.
- `critical`: high plus data exposure or loss, money movement, irreversible data operations, or production config.

**Tier label:** `risk` and `merge` read the `Tier: High` / `Tier: Critical` labels of every ticket the PR names (the highest wins, none means Normal). For a `high` or `critical` ticket add it before the claim (`gh issue edit <N> --add-label 'Tier: High'`) and raise it as soon as the work shows greater risk; never lower or remove one. `normal` and `low` need none.

**Planner:** dispatch the `ticket-planner` role only on a planner trigger (engineering-method section 1; a `high` or `critical` tier is one) and never when the ticket's `Planning:` line links a plan. A linked plan is checked, not copied: `git diff <sha>..origin/<default_branch> -- <files>`; when it is not empty, read those hunks and their callers, amend the affected tasks and add one line to the PR's Review Notes. The length of the description does not decide, and a ticket that reads like a plan is input to verify. Without a trigger, write a 3-8 line inline plan into the claim comment. A plan whose diff outgrows its scope is re-tiered up and gets the planner for the rest. Brief and plan handling: `.ticketflow/skills/implement-ticket/planner.md`.

**State exactly one `Planning:` line** in the claim comment: `planner (strong class, effort X)` plus the plan's path once saved; `planned earlier: <path>, re-verified because ... by <planner | main session: files unchanged since <sha>>`; `inline: <the plan>` (`normal`, no trigger); `none (low)`. "Plan ready", model or effort text and a detailed description never count as planned.

**Implementer:** you, in this session, standard class at high by default, also after a planner plan. A strong helper only for an isolated hard piece; the strong class or xhigh only for genuinely hard reasoning, never because of the tier. Hidden complexity later: escalate that problem alone, do not re-plan the ticket.

## 3. Implement, in this session

One context, one conventional commit per task, `Refs #<N>` in the body, never a closing keyword. Work as the engineering-method skill says. A deviation from the plan gets one line in the PR's Review Notes.

**Scope discipline:** a related small problem (caused or exposed by the ticket, same flow or files) is fixed in this PR, tested and listed as "Also fixed"; so is every finding of a reviewer, CI, a smoke check or a delegated agent, or it is rejected with the reason; never leave an unticketed gap. Only a big (its own plan or tier, another subsystem, needs a decision) or unrelated problem gets its own issue (create-ticket), linked from this one; if fixing is cheaper than writing the issue, fix. Partial delivery: the rest gets its own issue. Never commit secrets or env files. Put this rule in every brief.

**Several tickets** in one run: `orchestrate-tickets`.

## 4. Verify

- `ci` mode: focused checks while working; **never the full `verify.command` locally**, GitHub Actions is the one full verification.
- `tiered` mode: focused checks while working, never the full command in the working tree. With the PR open as a draft run `verify-route.mjs <PR>` from the primary checkout: `local` means `local-verify.mjs <PR>` there, run in the background (the action "Run in the background and wait once": a verification can outlast one tool call; it marks the PR ready after the green gate; no separate `verify.command`); `ci` means `gh pr ready <PR>` and Actions runs the full verification. High/Critical labels, Security and changes to TicketFlow verification machinery force CI; a routing failure is CI-only. A failed local verification: fix, commit, push, run it on the new head.
- `local` mode: `local-verify.mjs <PR>` once after the last substantive change, in the background as above (it marks the draft ready on green); the PR workflow skips the configured verification.
- All modes: a UI, navigation or flow change is proven live (dispatch the `e2e-verifier` role when `live_verify_skill` is set, otherwise check it yourself).
- A check that cannot run becomes a deferred row (post-merge.md), never a claim.

## 5. Pull request and review

1. Stage explicit paths (never everything), push.
2. In one call run `node .ticketflow/scripts/queue.mjs <N>` and `gh pr create` from the template, starting `Ticket #<N>` (an open PR on another branch means another session got there first: stop and report). `ci` mode: ready. `tiered` and `local` mode: `--draft`, then the route of step 4. A new push repeats the route and the verification decision.
3. Wait with the primary checkout as the working directory (the action "Wait for a script" gives the timeout flag): `node .ticketflow/scripts/pr-wait.mjs <PR>`; on exit 2 with a timeout run it again. Exit 0: done, read `Review:` and `Unresolved threads:`; 1: CI red (fix, push once, wait again); 2: a draft, no local gate yet (the note says what to run) or a timeout; 3: Actions refused the run. On any non-zero exit, `results`, `changes requested`, a listed thread, `unknown` or a first comment read `.ticketflow/skills/implement-ticket/review-wait.md`. Dispatch `pr-reviewer` only after the wait completed. The exit 0 output ends with the lane lines of `risk.mjs` (run `node .ticketflow/scripts/risk.mjs <PR>` only when they are missing or after a new push): `Lane: self-check` and tier `low` or `normal`: post a self-check (step 6); otherwise dispatch `pr-reviewer` at the class of its `pr-reviewer class:` line (start from it; a different class needs a reason in the Run line) and the effort of the tier (`normal`, `high` high; `critical` xhigh; a `low` change in the review lane medium; a map that cannot honour a class runs the role at its frontmatter class and says so). `Lane: review` requires a review whatever the tier; a `risk.mjs` error counts as `review` and the strong class. Brief the role with facts, not pasted documents: the ticket number, the config values it needs, the `custom/` files that exist, what you read and verified, the decisions, the previous reviewed head; it reads the ticket once itself.
4. The `pr-reviewer` report (and a review an orchestrator dispatched) is handled as `review-wait.md` says.
5. Fix round: batch every finding (threads, external results, reports), sweep each class; in `tiered` and `local` mode convert the PR to draft (`gh pr ready <PR> --undo`) **before each new push**, then repeat the route and the gate; push once; answer every listed thread with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (reply on stdin: the fix commit, or the reason for rejecting it), which also resolves it; `merge` refuses any unresolved thread. A push starts a new cycle. **The review of the new head depends on the last review:** after a `ready to merge` review, fixes to its should-fix and nit findings merge on a self-check when `merge --self-checked` accepts the delta; after `changes needed`, a `pr-reviewer` delta review (or an external result on the head); a `critical` ticket always gets a new review. A security, data or correctness finding rejected without a fix gets a `pr-reviewer` pass on the head, with the finding in the brief.

## 6. Merge

From the primary checkout: `node .ticketflow/scripts/merge.mjs <PR>` when a `pr-reviewer` review of the head is the record; `merge.mjs <PR> --reviewed-by '<login>'` (quote a `[bot]` login) when an external reviewer's result on the head is the one you acted on (`--review-result-url '<exact link from pr-wait>'` only as `review-wait.md` says); `merge.mjs <PR> --self-checked` when your own self-check is the record (tier `low` or `normal`, or a fix delta after a ready review; never the first review of `high` or `critical`).
- A `pr-reviewer` review is a review on the exact head, any wording: the role posts it itself, or you post its report through `gh pr review <PR> --comment --body-file -`. `merge` does not read its text: you read the verdict and findings and merge only when blockers are fixed.
- A self-check is a review you post the same way on the exact head, short (about 10 lines): `Self-check head: <sha7>`, the acceptance criteria with their evidence, `Invariant sweep:` and `Not checked:`.
- If `merge` refuses, take what it prints (the next lane is `pr-reviewer` on the head) and never argue with it. A relevant reviewer still working: wait for its result or its original 15-minute window. Merge no other way, never use the admin bypass; when the gates pass, merge without asking, except when the only review was an inline `pr-reviewer` (generic action map): then ask the user first.

## 7. After the merge

From the primary checkout (`git -C <primary> pull --ff-only`):
- **Handoff:** `node .ticketflow/scripts/ticket.mjs handoff <N> --pr <PR>` with the summary on stdin (heredoc, about 15 lines plus the Run line): what merged (PR and merge commit), the evidence, the decisions applied, the assumptions, "Also fixed", the follow-ups (each with its issue number), what was not verified. It sets "In Review" when `project` is set and posts once per PR (a repeat says when your text differs). The issue stays open; Done (`project.mjs status <N> Done` if set, then `gh issue close <N>`) only when the owner asks; Blocked only with a comment naming the blocker and the next action. A tracker child: after the summary run `tracker-next.mjs <T>` for your report.
- **Run line** at the end of the summary: `Run: tier <t> · main <model>/<effort> · planner <matches the Planning line> · reviewer <names | pr-reviewer/class/effort | self-check | none> · review rounds <n> · CI runs <n> · fallback <yes|no>`.
- **Cleanup:** remove the ticket worktree, delete the local branch and your scratch files, stop every shell and loop you started.
- Read `.ticketflow/skills/implement-ticket/post-merge.md` only when `deploy_branch` is set, a check was deferred, or `custom/post-merge.md` was listed.
- Report to the requester in a few lines: what merged, the evidence, the decisions or questions that remain.

**Waiting:** only bounded waits; never `sleep`, poll or `pgrep -f` loops (they match themselves); kill what you started; never report while a wait is running.

**Stop and ask when** a material decision comes up, an unanticipated schema or live-data change is needed, the acceptance criteria conflict with the code, or verification cannot run.
