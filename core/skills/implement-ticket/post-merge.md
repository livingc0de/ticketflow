# After the merge

Read `.ticketflow/custom/post-merge.md` first if it exists: it adds to and overrides this file. It holds the repo's deploy and smoke steps.

## Status and summary

- When `project` is set in the config, set the status with `node .ticketflow/scripts/project.mjs status <N> "In Review"`. The issue stays open. Done (`project.mjs status <N> Done` if set, then `gh issue close <N>`) only when the owner explicitly asks. Blocked only with a comment naming the blocker and the next action.
- Post a summary comment on the ticket (`gh issue comment <N> --body-file -`): what merged (PR and merge commit), the evidence, the decisions applied, the assumptions, "Also fixed", the follow-ups (each with its issue number), and anything not verified or deferred. End it with the `Run:` line:

  `Run: tier <t> · main <model>/<effort> · planner <matches the Planning line> · reviewer <names | pr-reviewer/effort | none> · review rounds <n> · CI runs <n> · fallback <yes|no>`

- A tracker child: post the summary on the child, then run `node .ticketflow/scripts/tracker-next.mjs <T>` and use its output for your report.

## Deferred checks

A live or behaviour check that could not run (missing key, provider, deploy, real device) is never skipped silently.
- When `deferred_checks_issue` is set in the config (number `D`): add a row to issue `D`, `- [ ] #<N>: <check> - blocked by <x>`, and write "Deferred checks: #D" in the PR and in the summary.
- Otherwise list them in the summary under "Not verified".

## Default branch CI

When `deploy_branch` is set, watch the merge commit in the background: `node .ticketflow/scripts/pr-wait.mjs <merge sha>`. Exit 0: fine. Exit 1: fix it now. Exit 3 (Actions refused the run): `git -C <primary checkout> pull --ff-only`, then, with the primary checkout as the working directory, `node .ticketflow/scripts/local-verify.mjs <merge sha>`. Exit 2 (superseded by a newer commit, or a timeout): check the newest default-branch commit instead and report.

## Cleanup

Remove the ticket worktree, delete the local branch, and delete the scratch files you made (never commit them). Stop every shell and loop you started.

Report to the requester in a few lines: what merged, the evidence, and the decisions or questions that remain.
