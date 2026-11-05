# Acting on pr-wait and the reviews

Read `.ticketflow/custom/review-wait.md` first if it exists: it adds to and overrides this file. `SKILL.md` step 5 item 3 starts `pr-wait`; this is what each result means. `pr-wait` watches the head for review bots or people that start (a reaction, a comment, a review) and waits for each one's result, at most 15 minutes from its start.

## Exit 0

Read its `Review:` and `Unresolved threads:` lines.

- `results (<logins>)`: read each result (the link on its `Review <login>:` line) and fix or answer every finding (the fix round, `SKILL.md` step 5 item 5). Check both specification compliance (acceptance criteria, missing or extra work) and code quality (correctness, security, tests, simplicity) in one pass. A bot's result must not be considered approval merely because a comment was observed.
- One that says more is coming, or a `first comment` that is only a status note (the review is still running): wait again with `--more '<login>'`.
- A first comment that is a **complete** review can be used immediately by passing its exact link as `--review-result-url` in step 6, but only after reading it fully and addressing its findings. Do not pass it for progress, quota or failure messages.
- A comment that is not a review (a deploy or coverage note), an error or quota note, or a result about another commit than the head, is no result.
- `none` or no usable result: the lane decides (`SKILL.md` step 5 item 3). After an external result `pr-reviewer` also runs on `critical`, when the ticket or the owner asks, and on `high` only where the result does not cover the risky part (auth, money or migration logic it never discussed), never for the tier alone.
- `changes requested (...)`, a listed thread or `unknown`: the fix round, then wait again.
- If a relevant reviewer is still working, wait for its result or its original 15-minute window even when an internal review is ready; another review does not complete that reviewer's work.

## Exit 1 (CI red)

Fix and push once, then wait again (never review a red head). When it prints a behind-the-base hint, `gh pr update-branch <PR>` first, then `git pull` in the worktree.

## Exit 2

A draft (`local-first` or `tiered`): in tiered mode, run `verify-route <PR>` first, complete `local-verify <PR>` if it prints `local`, then `gh pr ready <PR>`; for a CI route simply mark ready. In local-first mode finish its local checks first. Otherwise a timeout: `pr-wait.mjs <PR> --once`, then report. Otherwise a timeout: `pr-wait.mjs <PR> --once`, then report.

## Exit 3 (Actions refused the run)

`git -C <primary checkout> pull --ff-only`, then, with the primary checkout as the working directory, `node .ticketflow/scripts/local-verify.mjs <PR>`. Its exit 0: wait again. 1: a failure was posted, or nothing was (head moved, behind, timeout): read the output, fix or update, push, wait again. 2 or 3: report it.

## The `pr-reviewer` report

`pr-reviewer` reports every finding to you: act on that report; its posted review is merge's record. Brief it with the previous reviewed head: it reviews the delta plus what it touches (standard class, medium effort, unless the finding was security or data: then strong). A review someone else dispatched (an orchestrator) is read from the PR.
