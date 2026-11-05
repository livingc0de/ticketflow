---
name: implement-ticket
description: Use when asked to implement, continue or fix a GitHub ticket ("implement #N", "the next ticket", "next child of #T"), before any branch, commit, PR, merge or status change for it.
---

# Implement a ticket

- Read `.ticketflow/custom/implement-ticket.md` first if it exists: it adds to and overrides this file. Read `.ticketflow/config.json` once.
- Actions (dispatch a role, ask the user, run in the background) are done as the action map your stub names says; without one, use `.ticketflow/agents-map/generic.md`.
- This skill is the whole flow for ticket work. How the work is done (the planner triggers, test first, debugging, the smallest change, delegation, evidence before claims, and no other plugin's flow on top) is `.ticketflow/skills/engineering-method/SKILL.md`; read it before step 2.

## 1. Read and claim

- **Ticket:** the one named, or the first open child from `node .ticketflow/scripts/tracker-next.mjs <T>`. "The next" is exactly one ticket; "all" or a list of tickets goes to `orchestrate-tickets`; if unclear, ask.
- **Read** it with `node .ticketflow/scripts/issue.mjs <N>`, plus its linked plans and the docs it names. Later comments override the description. A statement about behaviour ("the job starts by itself") is checked in the code, never reinterpreted.
- **Readiness gate:** scope, acceptance criteria and verification must be coherent and checkable against the code. A material gap (a decision, a criterion you cannot verify, an unmerged dependency): ask one targeted question; with a recommended default, set `Needs: Decision`, say so on the ticket and continue other unblocked work. A non-material gap: state your assumption in the claim comment.
- **Already started:** `node .ticketflow/scripts/queue.mjs <N>` shows an open PR (a closed one is history), `merged`, `done`, or `in-progress` with no PR (a crash after the claim): read `.ticketflow/skills/implement-ticket/resume.md`, which replaces Claim and Workspace. Never a second claim comment, worktree add or PR.
- **Claim:** one call, `node .ticketflow/scripts/ticket.mjs claim <N>` with the claim comment on stdin (heredoc): the tier, the assumptions and exactly one `Planning:` line (step 2). It assigns you, sets "In Progress" when `project` is set, and posts the comment once (a repeated call keeps the existing one).
- **Workspace:** `git fetch origin` every time, then `git worktree add --no-track <worktrees_dir>/<branch> -b <type>/issue-<N>-<slug> origin/<default_branch>`, then `verify.install` there. Edit and test in the worktree; run `pr-wait`, `merge` and `local-verify` with the up-to-date primary checkout as the working directory (`git -C <primary> pull --ff-only` first), so a branch never gates itself.

## 2. Route

**The tier sets the process** (`.ticketflow/docs/WORKFLOW.md` Risk tiers: planning, reviewer and class, fix rounds). Classify up when unsure; labels do not lower it. Classify by what a wrong change could break, not where the code lives:
- `low`: copy, docs or config value in one file.
- `normal`: logic in one subsystem, already tested.
- `high`: auth, permissions, grants or row-level rules; billing or money; data deletion or migrations that rewrite rows; locks, queues, transactions, idempotency, webhooks or async jobs; legal, consent or kids' data; external write integrations; production boot, deploy scripts or config, admin grants or startup gates; scripts, config, deploy and docs together; three or more subsystems or about 8 files; an ambiguous or conflicting spec.
- `critical`: high plus data exposure or loss, money movement, irreversible data operations, or production config.

**Tier label:** `risk` and `merge` read the `Tier: High` / `Tier: Critical` issue labels of every ticket the PR names (the highest wins, none means Normal). For a `high` or `critical` ticket add the label before the claim (`gh issue edit <N> --add-label 'Tier: High'`), and add or raise it as soon as the work shows greater risk; never lower or remove a higher one. A `normal` or `low` ticket needs no label.

**Dispatch the `ticket-planner` role only on a planner trigger** (the list is in `.ticketflow/skills/engineering-method/SKILL.md` section 1; a `high` or `critical` tier, or the ticket asking for it, is one). The length of the description does not decide, and a ticket that reads like a plan is input to verify. Without a trigger, write the 3-8 line inline plan into the claim comment and build it. A plan whose diff grows past its stated scope is re-tiered up and gets the planner for the rest.

**State exactly one `Planning:` line** in the claim comment:
- `Planning: planner (strong class, effort X)`, plus the plan's path once committed
- `Planning: planned earlier: <path>, re-verified because ... by <planner | main session: files unchanged since <sha>>`
- `Planning: inline: <the 3-8 line plan>` (`normal`, no trigger)
- `Planning: none (low)`

**Implementer:** you, in this session, in the standard class at high by default; after a planner plan too. A strong helper only for an isolated hard piece (the engineering-method table); the strong class or xhigh only for genuinely hard reasoning, never because of the tier. Hidden complexity later: escalate that problem alone, do not re-plan the ticket.

**Planner or an earlier plan:** read `.ticketflow/skills/implement-ticket/planner.md` when you dispatch the planner or the ticket's `Planning:` line links a plan (a model or effort text, "plan ready" or a detailed description never counts as planned).

## 3. Implement, in this session

One context, one conventional commit per task, `Refs #<N>` in the body, never a closing keyword. Work as the engineering-method skill says (test first, debugging, the smallest change, delegation). A deviation from the plan gets one line in the PR's Review Notes.

**Scope discipline:** a problem found while working that is related (caused or exposed by the ticket, same flow or files) and small is fixed in this PR, tested, and listed as "Also fixed". The same holds for every finding of a reviewer, CI, a smoke check or a delegated agent: fix it, or reject it with the reason; never leave an unticketed gap. Only a big (its own plan or tier, another subsystem, needs a decision) or unrelated problem gets its own issue (create-ticket skill), linked from this one. If fixing is cheaper than writing the issue, fix. Partial delivery: the rest gets its own issue. Never commit secrets or env files. Put this rule in every brief.

**Several tickets** in one run: `orchestrate-tickets`. This skill is for one ticket.

## 4. Verify

- `ci` mode: run focused checks while working. **Do not run the full `verify.command` locally**; GitHub Actions is the one full verification.
- `tiered` mode: run focused checks while working, never the full `verify.command` in the working tree. After opening the PR as a draft, use `verify-route.mjs <PR>`: `local` means run `local-verify.mjs <PR>` from the primary checkout and mark ready only after a green local gate; `ci` means mark ready and let Actions run full verification, with no local duplicate. High/Critical labels, Security and sensitive changed files force CI. If local verification fails, fix, commit, push and run it on the new head.
- `local` mode: run `verify.command` once after the last substantive change, then let CI independently repeat it (deliberate dual verification).
- All modes: a UI, navigation or flow change is proven live (dispatch the `e2e-verifier` role when `live_verify_skill` is set; otherwise check it yourself).
- A check that cannot run becomes a deferred row (post-merge.md), never a claim.

## 5. Pull request and review

1. Stage explicit paths (never everything), push.
2. Run `node .ticketflow/scripts/queue.mjs <N>` again first: an open PR on another branch means another session got there first, so stop and report. Then `gh pr create` from the template, starting `Ticket #<N>`. `ci` mode: ready. `tiered` mode: create `--draft` every time, run `verify-route.mjs <PR>`, follow the route in step 4, then `gh pr ready <PR>` once the selected gate has passed or CI is selected. `local` mode: `--draft` if the local checks have not all passed yet, then `gh pr ready <PR>` when they have (CI starts then).
   In `tiered` mode, use the **primary checkout** for `verify-route.mjs <PR>`; if it prints `local`, run `local-verify.mjs <PR>` there before `gh pr ready <PR>`, and do not run `verify.command` separately. If it prints `ci`, make the PR ready immediately and do not run full verification locally. If routing fails, treat the PR as CI-only. On a new push repeat the route and verification decision.
3. Wait once, in the background, with the primary checkout as the working directory: `node .ticketflow/scripts/pr-wait.mjs <PR>`. Its exit code decides: 0 done (read `Review:` and `Unresolved threads:`), 1 CI red (fix, push once, wait again), 2 a draft or a timeout, 3 Actions refused the run. Read `.ticketflow/skills/implement-ticket/review-wait.md` whenever it exits non-zero or reports `results`, `changes requested`, a listed thread, `unknown` or a first comment (and for the `pr-reviewer` report). Exit 0 with `Review: none` or no usable result: the lane decides. `pr-reviewer` is dispatched only after the wait has completed, never in parallel with it (the cases where it also runs after an external result are in `review-wait.md`). Run `node .ticketflow/scripts/risk.mjs <PR>`. `Lane: self-check` and tier `low` or `normal`: post a self-check (step 6). Otherwise dispatch `pr-reviewer` now, at the class and effort of the tier as your action map's row for dispatching a role says (`normal` standard/high; `high` strong/high; `critical` strong/xhigh; a `low` change whose lane is `review` standard/medium; a map that cannot honour a class runs the role at its frontmatter class and says so). `Lane: review` requires a review whatever the tier; a `risk.mjs` error counts as `review`.
4. The `pr-reviewer` report (and a review an orchestrator dispatched) is handled as `review-wait.md` says.
5. Fix round: batch every finding (threads, external results, reports) and sweep each class; in `tiered` mode convert the PR to draft (`gh pr ready <PR> --undo`) **before each new push**, then repeat the route and local gate (if selected) before making it ready again; push once; answer every listed thread with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (reply on stdin: the fix commit, or the reason for rejecting it), which also resolves it; `merge` refuses any unresolved thread, from any author. A push starts a new cycle: wait again. **The review of the new head depends on the last review:** after a `ready to merge` review, fixes to its should-fix and nit findings merge on a self-check when `merge --self-checked` accepts the delta (small, no risky path); after `changes needed`, a `pr-reviewer` delta review (or an external result on the head); a `critical` ticket always gets a new review. A security, data or correctness finding rejected without a fix gets a `pr-reviewer` pass on the head, with the finding in the brief.

## 6. Merge

With the primary checkout as the working directory: `node .ticketflow/scripts/merge.mjs <PR>` when `pr-reviewer`'s ready verdict on the head is the review, `merge.mjs <PR> --reviewed-by '<login>'` (quote a `[bot]` login) when an external reviewer's result on the head is the one you acted on (`--review-result-url '<exact link from pr-wait>'` only as `review-wait.md` says), or `merge.mjs <PR> --self-checked` when your own self-check is the review of record (tier `low` or `normal`, or a fix delta after a ready review; never the first review of `high` or `critical`). The self-check is a review you post on the PR on the exact head in the template of `.ticketflow/docs/REVIEWERS.md` ("The self-check lane"): `Self-check head: <sha7>`, the exact verdict line, acceptance criteria with evidence, an invariant sweep, and what was not checked. `merge` verifies the eligibility from the diff; if it refuses, take the next lane (`pr-reviewer` on the head) and never argue with it. If a relevant reviewer is still working, wait for its result or its original 15-minute window even when an internal review is ready. On exit 1 do what it prints. Merge no other way and never use the admin bypass; when the gates pass, merge without asking, except when the only review was an inline `pr-reviewer` (generic action map): then ask the user first.

## 7. After the merge

Read `.ticketflow/skills/implement-ticket/post-merge.md`.

**Background hygiene:** only bounded waits; no `pgrep -f` loops (they match themselves); kill what you started; never report while a wait is running.

**Stop and ask when** a material decision comes up, an unanticipated schema or live-data change is needed, the acceptance criteria conflict with the code, or verification cannot run.
