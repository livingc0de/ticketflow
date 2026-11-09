# Resuming a ticket that was already started

This replaces Claim and Workspace of `SKILL.md` step 1. Read `.ticketflow/custom/resume.md` only if the step 1 call listed it; it adds to and overrides this file. `queue.mjs <N>` (already run) shows an open PR (a closed one is history), `merged`, `done` or `in-progress`.

- **An open PR:** reuse the PR's worktree or branch (never a second claim comment, worktree add or PR) and continue from the PR.
- **`merged`:** step 7 only, skipping what is done, never repeating a deploy or migration step.
- **A continue or resume request** (an orchestrator lead, "continue #N") with `done` and a merged PR: nothing to build and never a second PR. Without a project, step 7 only when its summary comment is missing, otherwise stop and report.
- **An owner's explicit request to change an In Review ticket** is a new change in the running ticket.
- **`in-progress` with no PR** (a crash after the claim): reuse the branch and worktree that match `issue-<N>-` (`git ls-remote --heads origin`, `git worktree list`) and the claim comment; never a second claim, branch or worktree.
