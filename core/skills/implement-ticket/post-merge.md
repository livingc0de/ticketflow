# After the merge: deploy, deferred checks, default-branch CI

Read `.ticketflow/custom/post-merge.md` only if the step 1 call listed it: it adds to and overrides this file and holds the repo's deploy and smoke steps. The handoff, the summary, the Run line and the cleanup are in `SKILL.md` step 7.

## Deferred checks

A live or behaviour check that could not run (missing key, provider, deploy, real device) is never skipped silently.
- When `deferred_checks_issue` is set (number `D`): add a row to issue `D`, `- [ ] #<N>: <check> - blocked by <x>`, and write "Deferred checks: #D" in the PR and the summary.
- Otherwise list them in the summary under "Not verified".

## Default branch CI

When `deploy_branch` is set, wait for the merge commit (the action "Wait for a script"): `node .ticketflow/scripts/pr-wait.mjs <merge sha>`. Exit 0: fine. Exit 1: fix it now. Exit 3 (Actions refused the run): `git -C <primary checkout> pull --ff-only`, then from the primary checkout `node .ticketflow/scripts/local-verify.mjs <merge sha>` (in the background). Exit 2: superseded by a newer commit, check the newest default-branch commit instead and report; a timeout, run it again.

## Efficiency (optional)

For a retained Claude Code JSON result or Codex JSONL session record: `node .ticketflow/scripts/efficiency.mjs <capture.json|capture.jsonl> [--wait-log <pr-wait.log>]` prints an `Efficiency:` line to append to the summary when it reflects this ticket's session. It reports duration, tokens and cost only when the CLI captured them and marks delegated-agent coverage unknown; use `unknown` for missing totals, never estimates. No external telemetry, new dependency or second tracking process.
