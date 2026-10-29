# Workflow

This is the heart of TicketFlow: how a piece of work travels from an idea to merged code, and why each step exists. Agents follow
the same rules step by step through the `implement-ticket`, `create-ticket` and `engineering-method` skills; this page explains them for people, in one
place. For what the board statuses and labels mean, see [PROJECT.md](PROJECT.md).

**The short version:** every change that ships starts as a ticket, is planned unless it is small and obvious, is built on its own branch,
proves itself with a green gate, gets a review, merges only through a script that checks all of that, and comes back
to you as In Review with a summary. You decide when it is Done.
Asking an agent to fix a bug or build something starts (or finds) a ticket. Work that ships nothing (an investigation, a review, an audit, a local experiment) gets the same engineering
method without the ticket ceremony: [Without a ticket](#without-a-ticket).

## Lifecycle

ticket, plan, implement, verify, review, merge, handoff.

1. **Ticket.** One issue is one shippable unit that one pull request can complete; anything bigger is a `Type: Initiative` tracker
   with children. Type, priority, work effort, model class, AI effort and (when relevant) environment are labels; tier and planning are decided when work starts.
2. **Claim.** Assign, set the status to In Progress, post a claim comment with the tier, the assumptions and one `Planning:` line.
   Work happens in a git worktree on a `<type>/issue-<N>-<slug>` branch from the up-to-date default branch.
3. **Plan** (below), **implement** in one context with one conventional commit per task, `verify`, open the pull request.
4. **Review** (below), then **merge** only through `merge`, which checks every gate on the exact head, then merges with a method the
   repo allows (squash first; `protect --squash-only` makes it the only one, on the owner's choice).
5. **Handoff.** Status In Review, the issue stays open, and a summary comment ends with the Run line. Done only when the owner asks.

Pull requests and commits say `Ticket #N` or `Refs #N`, never a closing keyword (Closes, Fixes, Resolves): nothing may close or
move the issue on merge.

## Risk tiers

A tier sets review depth and verification, nothing else. Classify up when unsure; a ticket's recommendation can raise a tier,
never lower it. The `implement-ticket` skill holds the full definitions; in short:

- `low`: copy, docs or a config value in one file.
- `normal`: logic in one subsystem, already tested.
- `high`: anything touching access, money, data migrations, concurrency or async work, legal or consent, external writes,
  production boot or deploy config, an ambiguous spec, or three or more subsystems.
- `critical`: `high` plus data exposure or loss, money movement, irreversible data operations, or production config.

The implementer runs in the standard class at `high` by default: it is cheaper, and the planner and the reviewer, who catch
mistakes, stay on the strong class. The implementer moves up to the strong class or `xhigh` only for genuinely hard reasoning (a
subtle lock order, a money state machine), never because of the tier.
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

## Building: tests, bugs and small changes

TicketFlow carries its own engineering method in the `engineering-method` skill and the two roles; no other plugin is needed. In a
ticket it is how steps 3 and 4 of `implement-ticket` are done; without one it is the whole method (next section).

- **Understand first.** Read the code and docs before asking anything. A clear request is simply done; a vague or risky one is played
  back in two sentences with the one question that changes the most. 2-3 approaches are offered only when a real choice is open, and
  "go" proceeds on the defaults the agent stated.
- **A bug is reproduced first** (a failing test, or captured output) and its root cause named from evidence: the whole error, recent
  changes, the bad value traced to its source, a working case to compare. The fix goes where every caller routes through, not at the
  symptom.
- **Test first where it pays.** For non-trivial behaviour (a branch, a loop, a parser, money, security, a data write,
  concurrency), see a test fail for the right reason, then make it pass. A trivial, docs-only or generated change gets no new test;
  its effect is verified instead.
- **Tests assert behaviour, not wiring,** and a trust boundary gets a case that must be refused.
- **The smallest complete change.** Does it need to exist? Is it already in the codebase, the standard library, the platform, an
  installed dependency? Then the least new code, counting the cost of owning it (options, dependencies, docs), never at the cost of
  security, validation, data-loss protection or accessibility. A deliberate limit gets a comment
  `shortcut: <limit>, <when to revisit>`, never over a security, data-loss or required-behaviour gap.
- **Evidence before claims.** "Fixed", "passes" or "reviewed" names the command run after the last change and what it printed; a
  helper's report is checked against the diff; what could not run is listed as "Not checked".
- **Delegation is the exception.** One context by default. A light helper searches, a strong one takes a hard isolated piece, one
  helper each for independent failures. After two failed attempts at the same failure the planner is asked for a targeted
  diagnosis; a third failure questions the design.
- **Findings are checked against the code** before they are acted on, and a feature nobody asked for is declined.
- **The roles use the same lens.** The planner takes the smallest complete change, maps every acceptance criterion to the check
  that proves it and weighs 2-3 approaches when a choice is open; it marks a task `review: task` only when it is high-risk and later
  tasks build on it. The reviewer's "Lean" lens asks what can be deleted or reused, names a concrete breaking case and the smallest fix
  for every blocker, and ends with a "Not checked" line.
- **Deviations are recorded.** A departure from the plan gets one line in the PR's Review Notes; a skipped plan whose diff grows gets
  the planner for the rest.

## Without a ticket

Asking for a change that ships ("fix this bug", "build X") is ticket work: the agent finds or creates the ticket (`create-ticket`
searches for a duplicate first), then follows `implement-ticket`. A small ticket stays small: a `low`-tier ticket has only a Goal
and acceptance criteria; labels carry the execution model and effort. Requests that ship nothing, or that you explicitly want local, get the `engineering-method`
skill's method without the ticket ceremony:

- **No ticket, branch, commit, PR or merge unless you ask.** Finishing is a short report: what changed, the evidence, what was not
  checked, the shortcuts added. A commit or PR is made when you ask. A PR opened that way is reviewed and merged like any other
  (below), with the rules of [SECURITY.md](SECURITY.md) unchanged. Asking the agent to merge is not a review.
- **Anything beyond an easy change gets a plan** from the `ticket-planner` role on a plain brief; no ticket is needed, and its open
  decisions come to you.
- **A review without a PR:** the `pr-reviewer` role in *diff mode* reviews a diff, range, branch or one task of a plan (a plan task
  marked `review: task` is reviewed on its commits before the next task starts; the default stays one PR-level review). In *audit
  mode* it maps the repo, states the expected load and returns up to 20 numbered findings (Must / Should / Nice, each with
  `path:line`, the concrete case, the smallest fix and the cost of skipping it), ending with `Verdict: no blockers | blockers found`, `Lean: -N lines possible` and
  `Not checked:`. Both report to you and post nothing, and a diff review's verdict is never the merge wording, so neither counts as the
  review `merge` needs. A review of a PR itself ("review PR #N") is the normal mode: one review posted on the PR.
- **Shortcut debt:** `node .ticketflow/scripts/debt.mjs [path]` lists every `shortcut:` comment with its limit and trigger. A row
  marked `[no-trigger]` needs one. It reads the tracked files and changes nothing.
- **"Why did that run go wrong, or cost so much?"** The agent reads the ticket's Run line, the PR timeline and commits, and whatever usage or
  transcript record your tool keeps (TicketFlow ships no counter), cites what was repeated, ignored or skipped, and changes nothing.

Work that should be tracked is `create-ticket` and `implement-ticket`; say so and the full journey starts.

## Verify

`verify.mode` in the config:

- **`ci`**: run focused checks while working; the gate status on the head is the full verification.
- **`local-first`**: run `verify.command` locally once after the last substantive change. Open the pull request as a draft until the
  local checks pass (CI skips drafts), then mark it ready, which starts CI.

In both modes a UI, navigation or flow change is proven live (the `e2e-verifier` role, when `live_verify_skill` is set). A check that
cannot run is never claimed: it goes in the `deferred_checks_issue` (when set) or the summary under "Not verified".
The gate itself: [CI-GATE.md](CI-GATE.md).

## Review

External reviewers (a review bot, a teammate) are never configured or asked. While CI runs, `pr-wait` notices any that start on the
exact head (a reaction, a comment, a review) and waits for each one's result, at most 15 minutes from its start, ending as soon as
it lands (a review, a comment or its edit); the agent reads and fixes what it finds. If none started by the time CI settles, or
none gave a usable result, the built-in `pr-reviewer` role reviews the
head and reports its findings straight to the agent; its posted review is what `merge` reads. A `critical` pull request gets
`pr-reviewer` after an external result as well; a `high` one only where that result does not cover the risky part. Its effort follows
the tier. It never approves or edits. A red CI is fixed first, with no review of a red head. Diff and audit mode review without a
pull request (above) and post nothing. What is and is not proven: [REVIEWERS.md](REVIEWERS.md).

Wait once, in the background (`pr-wait`), batch every finding into one push, and fix or reject each with a reason; reply to and resolve
each review thread with `thread.mjs`. A push needs a review of its new head: an external result, or a `pr-reviewer` review of the delta since its last one. A related small problem found along the way is fixed in the same pull request and listed as "Also fixed"; only a big or unrelated one gets its own issue.

## Merge

`merge <PR>` is the only way. It requires, on the exact head: the pull request open, not a draft, based on the default branch; the
gate status `success`; the head contains the default branch; no unresolved review thread (any author); no external reviewer that
started and has not answered (at most 15 minutes from its start) or requested changes; every trusted account's last `pr-reviewer`
verdict on the head exactly `ready to merge`; and a review of the head: the merging account's own `pr-reviewer` review, or, with
`--reviewed-by <login>`, that external reviewer's result on the head, which the agent read and acted on. What that proves: [REVIEWERS.md](REVIEWERS.md). It merges (squash, else rebase, else a
merge commit, as the repo allows) with `--match-head-commit`. When the gates pass, merge without asking, except when the only review
was an inline `pr-reviewer` (no sub-agents): ask the owner. The setup and update pull requests of `init` and `sync` are reviewed and merged
the same way, but only after you say so in chat, because they change the gate itself. Never `--admin`, never `--auto`; see [SECURITY.md](SECURITY.md).

## Several tickets (optional)

Most of the time you work one ticket: "implement #42". When you have a handful, the `orchestrate-tickets` skill can work through
them in one run. It is optional, and one ticket never needs it.

### Asking for it

Plain requests are enough:

- *"Work through #12, #13 and #14."* A list, in the order you gave it.
- *"Do all the children of #10."* A tracker: its sub-issues, in the tracker's order.
- *"Work the ready backlog."* No list, no tracker: see "The Ready-backlog warning" below.

### What happens

The orchestrator is a coordinator only. It never edits files, merges or reads code. For each ticket it dispatches a **fresh ticket
lead**, a helper that starts with an empty head (never a copy of the orchestrator's conversation) and follows `implement-ticket`
unchanged: claim, plan, build, verify, review, merge, hand off. The lead answers with one line, `Result #N: ...`.

After every result the orchestrator runs `queue.mjs`, which rebuilds each ticket's state from GitHub (the issue, its Status, labels,
`Depends on` lines and pull requests): `ready`, `in-progress`, `merged`, `blocked`, `waiting`, `conflict` or `done`. GitHub wins
over any report, so nothing depends on the orchestrator's memory. There is no ledger, lock or daemon.

### What you will see

- At the start: one announcement of the budget, how many tickets run at once, when it will stop and the line to resume with.
- A lead cannot ask you questions. When a ticket needs a real decision, the lead labels it `Needs: Decision` with a recommended
  default and reports `needs-decision`. In a list, the run moves on to the next ticket; in a tracker it stops, because later children
  may depend on the answer.
- At the end, a table: merged, In Review, blocked, needs a decision, not started, nothing to do. For each ticket: the pull request,
  the merge commit, the review, what was not verified and any follow-ups, plus totals from the leads' Run lines.
- Every merged ticket sits **In Review**. The orchestrator never marks anything Done; that is yours.

The run also stops when nothing is ready, when you say so, when one ticket has two open pull requests (`conflict`: it reports
both and touches neither), or when the host does: a session timeout, a usage or rate limit, a depth or concurrency cap, a dispatch that
is refused and cannot be worked around. Every stop and the final report end with `Resume: continue #a #b` (or `continue the children
of #T`), listing the tickets not merged yet.

### Resuming

If a session ends or you stop it, ask again, naming the scope: *"continue #12 #13 #14"* or *"continue the children of #10"*. State is rebuilt from GitHub: a
ticket whose pull request merged gets its handoff finished, one with an open pull request continues from it, one not started starts
fresh. Nothing is done twice and no second pull request is opened. Paste the `Resume:` line, or restate the tickets or the tracker; the
orchestrator does not remember them. A single ticket resumes the same way: *"continue #42"*.

### The Ready-backlog warning

With no list or tracker, the orchestrator works the **Ready** column of your Project. Because that is a bigger step than naming
tickets, it **warns you first**: it says it will work the Ready backlog, states the bound (at most the 10 highest-priority Ready
tickets, by Priority label, P0 first, then by number; tickets with no Priority label come last) and lists them. It then starts without waiting for an answer, so say *stop*
if that is not what you meant. Those ticket numbers are the scope from then on, since tickets leave Ready once claimed. To resume,
restate the numbers, or ask for the backlog afresh. This mode needs a Project in the config; without one it asks for a list.

### Controls

Three separate controls, all with safe defaults, and each can be changed by asking ("budget 5, two tickets at once"):

- **Depth:** orchestrator, then leads, then specialists (planner, reviewer); nothing deeper.
- **Budget B:** agents active at once, including the orchestrator. Default 3.
- **Ticket parallelism P:** tickets worked at once. Default 1, at most floor((B-1)/2), because each lead keeps a slot for its own
  specialist. With the default budget of 3 that is one ticket at a time; each extra ticket needs two more slots (budget 5 allows two). More than one only on request, and only for independent tickets (disjoint files, config and generated files, no order
  between them).

What each tool allows (installing and enabling them: [TOOLS.md](TOOLS.md)):

| Agent | Lead can dispatch roles | Concurrency cap (suggested, never written) | Fresh context | Checked on |
|---|---|---|---|---|
| Claude Code | yes, since 2.1.219 (read-only role agents cannot) | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=B-1` | yes, never a fork | 2026-10-27 |
| Codex | V1: only with `agents.max_depth = 2`; V2 ignores it | `agents.max_depth = 2`, `agents.max_concurrent_threads_per_session = B-1` | yes (`fork_context` false, V2 `fork_turns: "none"`) | 2026-10-27 |
| Cursor | yes, depth 2 at most | none documented | yes | 2026-10-27 |
| Gemini CLI | no | none | yes | 2026-10-27 |
| OpenCode | no (V2 depth 1) | none | yes | 2026-10-27 |
| Antigravity | yes | none documented | yes (does not inherit history) | 2026-10-27 |
| GitHub Copilot | VS Code only with `chat.subagents.allowInvocationsFromSubagents`; the cloud agent never | none | yes | 2026-10-27 |
| Any other | no | none | n/a | n/a |

Fallbacks: a lead that cannot dispatch plans inline and reports `needs-review` once CI is green; the orchestrator then dispatches the
`pr-reviewer` and a fresh lead continues the ticket. With no dispatch at all, one ticket is run and the run stops, and says so.

Limits:

- The Copilot cloud agent pushes only to `copilot/*` branches, which the `*/issue-<N>-*` match misses, so it is never an orchestrator
  or a lead.
- A run lasts as long as its session. There is no daemon; resume by asking again.
- Two orchestrators can claim one ticket within seconds; it shows afterwards as `conflict` in the queue. Run one coordinator per scope.
- `queue.mjs` matches tickets to pull requests by branch name (`*/issue-<N>-*`, same repository only) among the pull requests that
  reference the ticket plus the 100 latest-updated ones (so a quiet older ticket is still found); an issue with more than 100
  references (issues that mention it count too, so on a public repo a flood of mentions can cause this) stops it with exit 2, never a
  guessed state; at most 50 tickets; at most 10 pages of Ready items.
- Without a Project a merged ticket shows `done`, because its handoff cannot be seen.
- Follow-up work on a ticket after its merge needs its own ticket: the old merged pull request keeps the ticket `merged`.
- A `Depends on owner/other#N` ref to another repository keeps the ticket `waiting` until the owner edits it out of the ticket.

## Handoff and the Run line

After the merge: status In Review, a summary comment (what merged, the evidence, decisions, assumptions, "Also fixed",
follow-ups, anything not verified), then clean up the worktree. The comment ends with:

`Run: tier <t> · main <model>/<effort> · planner <matches the Planning line> · reviewer <names | pr-reviewer/effort | none> · review rounds <n> · CI runs <n> · fallback <yes|no>`

Optional `Efficiency:` metadata can be generated from an already-saved Claude Code JSON result or Codex JSONL session using `node .ticketflow/scripts/efficiency.mjs <capture>` (add `--json` for structured output). It reports the CLI's observed duration, token categories and cost; unavailable fields and descendant coverage remain `unknown`, never estimated or double-counted. Capturing sessions is optional; this is not a required service or merge gate.

It is how plan skips, review rounds and CI runs get measured ([TOKEN-BUDGET.md](TOKEN-BUDGET.md)). When `deploy_branch` is set,
watch the merge commit's CI too.

## Branching

Trunk-based. Pull request branches are short-lived and merge into the default branch; there is no long-lived `dev` branch.
Deploy only CI-green commits. Unfinished features ship behind settings flags, not on a branch. For production, promote the same
tested commit (a tag or release, or an environment approval) rather than adding a branch that diverges from the default branch.
