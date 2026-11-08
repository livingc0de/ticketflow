---
name: engineering-method
description: Use when writing, fixing, debugging, refactoring or reviewing code ("fix this bug", "build X", "review this diff", "audit the repo", "list the shortcuts"), and before saying work is done.
---

# Engineering method

- `.ticketflow/custom/engineering-method.md` adds to and overrides this file: read it if it exists (inside a ticket only when the step 1 call listed it). Dispatching a role and asking the user are done as your agent's own map in `.ticketflow/agents-map/` says (`implement-ticket` loads it; `generic.md` for any other agent).
- A request to ship a change (fix a bug, build, refactor) is ticket work: find or create its ticket (`create-ticket` searches first), then `implement-ticket`, which reads, plans and reports; apply the planner triggers of section 1 and sections 2 to 5 here. Without a ticket (the user says so, or nothing ships: an investigation, a diff review, an audit, a local experiment) all sections apply, and there is no branch, commit, PR or merge unless the user asks. No other plugin's planning, approval, branching, review or merge process runs on top of it; a technique may be borrowed if it adds no approval step and no second plan.
- Ask the user only about material decisions (product, data shape, security, money); take the default for the rest and say which.

## 1. Understand and plan

- Read the code and docs the request touches first; never ask what they already answer.
- A clear request: just do it. A vague or risky one: play it back in two sentences, then ask the one question that changes the most and say why. Offer 2-3 approaches with a recommendation only when a real choice is open. "Go" or "your call" proceeds on the stated defaults.
- **Plan in proportion.** Dispatch the `ticket-planner` role with a plain brief of facts (the request, what you read and verified, decisions made; no ticket needed) when any planner trigger holds, judged from the code you read: (1) the work is `high` or `critical` (access, money, data migrations, concurrency, legal, production config, three or more subsystems); (2) a real design choice is open (two or more defensible approaches with different consequences); (3) the change is cross-cutting: a second subsystem, or about 6 or more files; (4) a bug whose root cause is unclear after one reproduction and one trace; (5) two failed attempts at the same failure; (6) the user asks. Its Open decisions go to the user. Without a trigger, write a 3-8 line inline plan (files, approach, tests, risks) and build it; if the diff outgrows it, dispatch the planner for the rest. The length of the request does not decide. When torn on a `normal` change, plan inline and escalate if the diff outgrows it.
- Record decisions where they last: the ticket's Decisions and acceptance criteria, else the final report.

## 2. The smallest complete change

Stop at the first rung that holds: it does not need to exist (a speculative need is skipped, in one line) -> the codebase already has it (reuse) -> the standard library -> a native platform feature -> an installed dependency -> one line -> only then the least new code. Judge the cost of owning the change (code, options, dependencies, config, docs to maintain), not lines alone.
- Complete means callers, tests, config and validation are covered. Moved code keeps its checks. Never cut security, validation, data-loss protection, accessibility or a needed test to be smaller.
- At equal size take the option that is right on the edge cases.
- A deliberate limit gets a comment `shortcut: <limit>, <when to revisit>`, never over a security, data-loss or required-behaviour gap.

## 3. Test and debug

- **Bug:** reproduce it first (a failing test or captured output) and name its root cause with evidence: read the whole error, check what changed recently, trace the bad value back to where it starts, compare with working code. Then fix it where every caller routes through, not at the symptom.
- Non-trivial behaviour (a branch, loop, parser, money, security, data write or concurrency): see a test fail for the right reason, then make it pass. Trivial, docs-only or generated changes get no new test; verify the effect instead.
- Tests assert behaviour, not wiring; a trust boundary gets a negative case.
- Two failed attempts at the same failure: dispatch the `ticket-planner` role for a diagnosis (the failing output, not a transcript). A third: question the design, not the patch.

Work in one context. Delegate only when it pays, never a deterministic command, a lookup or one small task:
- Broad read-only search: a light helper.
- A hard, isolated piece (a lock order, a money state machine, a migration): a strong helper with a compact brief; do not edit its files meanwhile.
- Independent failures (different files, no shared state): one helper each; inside a ticket one at a time (a lead has one specialist slot), several at once only on a plain request and within any limit the user set.
- A plan task marked `review: task` (only `high` and `critical` plans mark any): the `pr-reviewer` role in diff mode on that task's commits; fix its blockers before the next task.

## 4. Verify

- Every claim ("fixed", "passes", "reviewed", "deployed") names the command run after the last change and what it printed. No such command, no claim. A helper's report is checked against the diff, not trusted.
- Turn each rule of the request and the guides into an invariant question ("can any unit exceed its budget?") and sweep the whole diff for it.
- What could not run is listed under "Not checked", never claimed.

## 5. Reviews

- **Receiving:** check each finding against the code, then fix it or reject it with the reason. No agreeing to be polite. A feature nobody asked for is declined (YAGNI) unless the code needs it.
- **A PR:** "review PR #N" goes to the `pr-reviewer` role in its normal mode, which posts one review on the PR. For a PR of your own, review and merge are `implement-ticket` steps 5 and 6.
- **No PR:** a diff, range, branch or plan task goes to the role in diff mode, "audit the repo" in audit mode, dispatched at the strong class. Both report and post nothing; relay the findings.
- **Shortcut debt:** `node .ticketflow/scripts/debt.mjs [path]` lists every `shortcut:` marker with its trigger; a row marked `[no-trigger]` needs one.

## 6. Report

- What changed, the evidence, "Not checked", the shortcuts added with their triggers. Short; no tour of the diff.
- Without a ticket, finishing is the report. Commit, push or open a PR only when asked; a PR opened that way is reviewed and merged as `implement-ticket` steps 5 and 6 say, minus the ticket references (a request to merge is not a review, and neither is a diff or audit report). The rules of AGENTS.md (no admin bypass) stand.
- "Why did this run go wrong, or cost so much?": read the ticket's Run line, the PR timeline and commits, and whatever usage or transcript record your tool keeps (TicketFlow has no counter; if the tool keeps none, say so rather than guess). Cite what was repeated, ignored or skipped, with evidence. Change nothing.
