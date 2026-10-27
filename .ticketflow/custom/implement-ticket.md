# implement-ticket: this repo

- **Plans stay local.** This repo is public: plans under `docs/plans/` are git-ignored and never committed (no plan commit on the ticket branch, no docs-only plan PR). Save the planner's output in the primary checkout's `docs/plans/` (never the ticket worktree, which post-merge removes) as `docs/plans/YYYY-MM-DD-issue-<N>-<slug>-technical.md` and put that path in the `Planning:` line; everything else about planning and re-verification is unchanged.
