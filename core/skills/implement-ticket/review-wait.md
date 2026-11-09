# Acting on pr-wait and the reviews

`pr-wait` (step 5.3) watches the head for review bots or people that start (a reaction, a comment, a review) and waits for each one's result, at most 15 minutes from its start. Read `.ticketflow/custom/review-wait.md` only if the step 1 call listed it; it adds to and overrides this file.

## Exit 0

Read its `Review:` and `Unresolved threads:` lines.
- `results (<logins>)`: read each result (the link on its `Review <login>:` line) and fix or answer every finding (step 5.5), checking specification compliance (acceptance criteria, missing or extra work) and code quality in one pass. A bot's comment is not approval.
- A result that says more is coming, or a `first comment` that is only a status note: wait again with `--more '<login>'`.
- A first comment that is a **complete** review can be used at once by passing its exact link as `--review-result-url` in step 6, after reading it fully and addressing its findings; never for progress, quota or failure messages.
- A comment that is not a review (a deploy or coverage note), an error or quota note, or a result about another commit than the head is no result.
- `none` or no usable result: the lane decides (step 5.3). After an external result `pr-reviewer` also runs on `critical`, when the ticket or the owner asks, and on `high` only where the result does not cover the risky part (auth, money or migration logic it never discussed), never for the tier alone.
- `changes requested (...)`, a listed thread or `unknown`: the fix round, then wait again.
- A relevant reviewer still working: wait for its result or its original 15-minute window even when an internal review is ready.

## Exit 1 (CI red)

Fix and push once, then wait again (never review a red head). With a behind-the-base hint: `gh pr update-branch <PR>` first, then `git pull` in the worktree. A `Local gate:` note on a red head (or one that says Actions will fail this head, which also exits 2): `gh pr ready <PR> --undo`, push a new head, then `local-verify.mjs <PR>` (in the background, as in step 4).

## Exit 2

A `Local gate: none` note that does not mention Actions failing, or a `Draft:` note: run `verify-route <PR>` (`tiered`), then `local-verify <PR>` from the primary checkout (in the background) when the route is local (it marks the PR ready), or `gh pr ready <PR>` for a CI route. Otherwise a timeout: rerun until CI and reviewers settle; report after about 45 minutes in total.

## Exit 3 (Actions refused the run)

`git -C <primary checkout> pull --ff-only`, then from the primary checkout `node .ticketflow/scripts/local-verify.mjs <PR>` (in the background, as in step 4). Its exit 0: wait again. 1: a failure was posted, or nothing was (head moved, behind, timeout): read the output, fix or update, push, wait again. 2 or 3: report it.

## The `pr-reviewer` report

It reports every finding to you: act on the report; its posted review is merge's record. Brief it with the previous reviewed head: it reviews the delta plus what it touches (class from `risk.mjs`, effort medium for a delta, strong when the finding was security or data). A review someone else dispatched (an orchestrator) is read from the PR.
