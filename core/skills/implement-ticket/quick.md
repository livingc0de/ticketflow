# The quick flow

`.ticketflow/custom/quick.md` adds to and overrides this file when the step 1 call listed it. It replaces the parts of `SKILL.md` it names; every other step, gate and floor of `SKILL.md` stands (merge only through `merge.mjs`, no admin bypass, always-review paths get a real review, the exact-head gate).

**When it applies:** the `mode` printed by the step 1 call is `quick`, or the ticket has a `Flow: Quick` label; never for a `Tier: Critical` ticket or a `Flow: Advanced` label (`risk` prints `Flow:` for the pull request). The user saying "do this one quick" or "advanced" adds that label with the claim (`claim <N> --label 'Flow: Quick'`); the label is what CI, `local-verify` and `merge` read.

## Replaces steps 1 and 2 (claim, plan)
- Read the ticket once (the batched first call) and never again before the handoff. Claim with at most 4 lines: the tier, `Flow: quick`, one `Planning:` line (planner triggers are unchanged: a `high` ticket still gets the planner; a `normal` or `low` one a 3-8 line inline plan kept in your own context, not in the comment).
- No `queue.mjs` call in step 5.2.

## Replaces step 5 (pull request and review)
1. Short PR body, not the template: `Ticket #<N>`, `Flow: quick`, the `Planning:` line, 2-4 summary bullets, `Verification:`.
2. Verify as step 4 says; with `verify.quick_command` the gate runs only the tests that cover the change.
3. One `pr-wait`; then **one review**, as the lane says: `Lane: self-check` (tier `low` or `normal`): post the self-check (step 6). Otherwise dispatch `pr-reviewer` once at the class of the `pr-reviewer class:` line (standard unless that line says strong), with a brief of facts: the ticket number, the head, the acceptance criteria pasted, the decisions; it reviews the diff only.
4. **At most one fix round.** Batch every finding of the review and of any external result, fix, push once (draft first in `tiered` mode), answer each listed thread with `thread.mjs`. The fixed head's record: `merge --self-checked` when it accepts the delta, otherwise one `pr-reviewer` delta review.
5. A blocker still open after that round: stop and report it to the owner. Should-fix findings and nits still open go into **one** follow-up issue (create-ticket), linked from the handoff; never a second fix round.

## Replaces step 6 (merge)
`node .ticketflow/scripts/merge.mjs <PR>` as soon as the gate is green and the review is done, without asking (the review flags of step 6 still say which record). Read its `Full run:` line: `started` needs nothing; `not started (...)`: run the printed command.

## Replaces step 7 (handoff)
One handoff comment of at most 8 lines plus the Run line (`flow quick`, `review rounds <n>/1`).
