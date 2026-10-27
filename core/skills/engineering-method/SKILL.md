---
name: engineering-method
description: Use when writing, fixing, debugging, refactoring or reviewing code, with or without a ticket ("fix this bug", "build X", "review this diff", "audit the repo", "list the shortcuts"), and before saying work is done.
---

# Engineering method

- Read `.ticketflow/custom/engineering-method.md` first if it exists: it adds to and overrides this file. Actions (dispatch a role, ask the user) are done as the action map your stub names says; without one, use `.ticketflow/agents-map/generic.md`.
- With a ticket, `implement-ticket` is the flow and this is how its steps 3 and 4 are done. Without one this is the whole method: no ticket, branch, commit, PR or merge unless the user asks. No other plugin's planning, approval, branching, review or merge process runs on top of it; a technique may be borrowed if it adds no approval step and no second plan.
- Ask the user only about material decisions (product, data shape, security, money); take the default for the rest and say which.

## 1. Understand

- Read the code and docs the request touches first, and never ask what they already answer.
- A clear request: just do it. A vague or risky one: play it back in two sentences, then ask the one question that changes the most and say why. Offer 2-3 approaches with a recommendation only when a real choice is open. "Go" or "your call" proceeds on the defaults you stated.
- Not easy and straightforward by the four tests of `implement-ticket` step 2 (`.ticketflow/skills/implement-ticket/SKILL.md`): dispatch the `ticket-planner` role with a plain brief (the request, what you read, decisions made); no ticket is needed. Its Open decisions go to the user.
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

Work in one context. Delegate only when it pays:

| Need | Action |
|---|---|
| Broad read-only search | dispatch a light helper |
| A hard, isolated piece (a lock order, a money state machine, a migration) | dispatch a strong helper with a compact brief; do not edit its files meanwhile |
| Independent failures (different files, no shared state) | one helper each, within the budget |
| A plan task marked `review: task` | dispatch the `pr-reviewer` role in diff mode on that task's commits; fix its blockers before the next task |

Never delegate a deterministic command, a lookup, or one small task.

## 4. Verify

- Every claim ("fixed", "passes", "reviewed", "deployed") names the command run after the last change and what it printed. No such command, no claim. A helper's report is checked against the diff, not trusted.
- Turn each rule of the request and the guides into an invariant question ("can any unit exceed its budget?") and sweep the whole diff for it.
- What could not run is listed under "Not checked", never claimed.

## 5. Reviews

- **Receiving:** check each finding against the code, then fix it or reject it with the reason. No agreeing to be polite. A feature nobody asked for is declined (YAGNI) unless the code needs it.
- **Requesting without a PR:** a diff, range, branch or plan task goes to the `pr-reviewer` role in diff mode; "audit the repo" goes to it in audit mode. Both report and post nothing; relay the findings.
- **Shortcut debt:** `node .ticketflow/scripts/debt.mjs [path]` lists every `shortcut:` marker with its trigger; a row marked `[no-trigger]` needs one.

## 6. Report

- What changed, the evidence, "Not checked", the shortcuts added with their triggers. Short; no tour of the diff.
- Without a ticket, finishing is the report. Commit, push or open a PR only when asked; merge only with `node .ticketflow/scripts/merge.mjs <PR>`; the rules of AGENTS.md (no admin bypass) stand.
- "Why did this run go wrong, or cost so much?": read the ticket's Run line, the PR timeline and your tool's usage or transcript view. Cite what was repeated, ignored or skipped, with evidence. Change nothing.
