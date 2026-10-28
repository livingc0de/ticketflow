# Reviewers

Every pull request gets a second pair of eyes before it merges. If you already use a review bot, or a teammate looks at your pull
requests, TicketFlow notices and waits for them; you configure nothing. If nobody reviews, TicketFlow's own `pr-reviewer` role does,
with no setup. When each review happens: [WORKFLOW.md](WORKFLOW.md).

## pr-reviewer

An independent review by the `pr-reviewer` role (strong model class, read-only). It checks, in order: acceptance criteria, security
and data, correctness and tests, money and legal logic, the repo's own rules, UI evidence, process (a `Planning:` skip without its four
reasons, a plan claim without a committed plan file, a closing keyword, out-of-scope changes) and over-engineering. It posts exactly
one review comment whose first line is `Reviewed head: <sha7>`, and reports its verdict, the head and one line per finding, each with
its fix, straight to the agent that asked, which acts on that report. When a later push needs a new review, it reviews the delta since
its last one plus what the delta touches, so the repeat is cheap. It never pushes, commits, edits or approves. Add repo lenses in
`.ticketflow/custom/pr-reviewer.md` and in the AGENTS.md "Review Guidelines" ([EXTENDING.md](EXTENDING.md)).

It runs when no external reviewer gave a usable result on the head, on every `critical` pull request, on a `high` one only where an
external result leaves the risky part uncovered, and when the ticket or the owner asks. Two more modes review without a pull request
and post nothing: *diff mode* (a diff, range, branch or one task of a plan) and *audit mode* (the repo or a path). They return a
report with the verdict `no blockers | blockers found`, so they never count as the review `merge` needs, which is always a review
posted on the pull request's head.

Without sub-agents (the generic action map) it runs inline in the same session. An inline review is not independent, so the owner is
asked before merging on it.

## External reviewers

No list, no login, no re-request comment: `pr-wait` reads what GitHub shows on the pull request.

- **Who counts.** An app (a `[bot]` login, or an account of type Bot) that reviewed or reacted on the pull request, or an owner,
  member or collaborator that reviewed it. The author of the pull request and the account running the script never count, and neither
  does an app that only comments (a deploy or coverage bot) or a commenter who never reviewed.
- **Push time.** Only activity after the head was pushed counts. That is the time of its first check suite, else its committer date
  (a commit made long before it was pushed can then admit older activity: a documented ceiling). Activity before the push, and reviews of
  another commit, decide nothing. A review of the head itself always counts, whatever its time: it can only exist after the push.
- **Start.** A reviewer has started when it has a sign on the head: a review of it, a comment or a reaction made after the push, or a
  comment edited after it. Its start is its first sign.
- **Result.** A review of the head, or a later comment of the same account with visible text (its first comment on the pull request is
  taken as its status note), counted at its last edit. A comment that names commits but not the head (a late receipt for an older
  commit) is a sign, never the result. It ends only that reviewer's own wait; another account's "looks good" neither starts nor ends it.
- **Window.** At most 15 minutes from its start, not from its latest edit. After that it is `late` and the wait moves on without it.
  A reviewer that said more is coming: `pr-wait.mjs <PR> --more '<login>'` counts only what it posts after that run started.
- **Changes requested.** A last review of the head that asks for changes ends the wait at once and is a refusal for `merge`.

`pr-wait` prints one `Review <login>: ...` line per such reviewer (`pending since ...`, `result <kind> <link> <first line>`,
`changes requested (<sha7>) <link>`, `no result 15 min after its start ...`), then one summary: `Review: pending (<logins>)`, else
`changes requested (<logins>)`, else `results (<logins>)`, else `none`, with `(no result in time: <logins>)` after results or none. A read
that fails prints `Review: pending (the review activity could not be read)`. CI red does not stop the wait for a reviewer that started
(all fixes go into one push); with nobody started it returns at once. A result says that a reviewer answered, never that it approved:
the agent reads the link, and an error, quota or status note is no result.

In pull request mode (not `--ci-only`, not a sha) it also prints `Unresolved threads: <n | unknown>`, then up to 20 lines `  [<thread id>] <path>:<line> @<author>
<first line>` for the unresolved review threads **of any author**. `unknown` means the read failed or there are more than 100.
Answer and resolve each with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (the reply on stdin: the fix commit, or the
reason for rejecting it). `pr-wait` flattens all GitHub text to one line, so it cannot forge a summary line.

## What merge needs

`merge` checks, on the exact head: green CI, up to date with the base, no unresolved thread, no external reviewer pending or asking
for changes, and a review of the head:

- **The merging account's own `pr-reviewer` review.** A submitted review of an `OWNER`, `MEMBER` or `COLLABORATOR` account with
  `Reviewed head: <sha>` (naming the head) and exactly one `**Verdict:** ready to merge`.
- **Or `--reviewed-by '<login>'`**, naming the external reviewer whose result on the head you acted on. `merge` checks that
  `pr-wait` lists that account with a result on this head, then prints a note. It cannot check what the result says: the agent read it.
- **Every trusted account's last verdict on the head must be ready.** A `changes needed` from any account blocks until that same
  account reviews again, a push moves the head (verdicts are per head), or the owner merges by hand. An outsider's review sets no
  verdict and lifts none. The label may be spelled `**Verdict:**`, `**Verdict**:`, `Verdict:`, indented or in any case, so a
  `changes needed` is never missed; only the exact bold line is ready.

`merge` reads no repository permission and posts no comment. GitHub's own rules (a ruleset, required approvals, branch protection)
decide who may merge; to require the owner's approval, see the high-assurance mode in [SECURITY.md](SECURITY.md).

## When merge says no

Every refusal names its reason and the next step.

| `merge` says | What it means | What to do |
|---|---|---|
| `N unresolved review thread(s)` | A review thread, from anyone, is still open | Fix it, or reject it with a reason. Reply and resolve it with `thread.mjs` (the reply on stdin), then push once if code changed |
| `unresolved review threads: unknown` | The threads could not be read, or there are more than 100 | Resolve what is open on the pull request, run `pr-wait` again |
| `changes requested (<logins>)` | An external reviewer's last review of this commit asks for changes | Fix and push (the new head is reviewed again), or, as the owner, dismiss the review on GitHub |
| `pending (<logins>)` ... `has not answered` | A reviewer started on this head and has not answered yet | Wait (`pr-wait`), at most 15 minutes from its start |
| `pending (the review activity could not be read)` | A GitHub read failed | Run again |
| `no review of <sha7>` | Neither an own `pr-reviewer` review of this head nor `--reviewed-by` | Run `pr-reviewer` on the head (a delta review is enough), or pass `--reviewed-by '<login>'` for the external result you acted on |
| `<login> has no result on <sha7>` | `--reviewed-by` names an account `pr-wait` did not list with a result on this head (another head, no activity, this account or the author) | Name the right account, or run `pr-reviewer` |
| `the last verdict of <login> ... not exactly "ready to merge"` | That account's newest verdict on the head is `changes needed`, misspelled or the unfilled template | Fix and push, then review again; only that account lifts its own verdict |
| `review <id> does not start "Reviewed head: <sha>"` | The own review names another commit or has no first line | Review again |
| `<base> moved (behind by n)` | The default branch has new commits (checked early and again right before the merge) | `gh pr update-branch <PR>`, wait for the new gate, review the new head, merge again |
| `CI / Gate is ... on <sha7>` | The gate is not green on this exact commit | Wait for it or fix what failed ([CI-GATE.md](CI-GATE.md)) |

An agent never lifts any of these on its own, and the script has no flag to skip a check. A `pr-reviewer` review is a comment, which
GitHub cannot dismiss: a wrong `changes needed` is answered by running `pr-reviewer` again on the head with the reason. The owner can
also dismiss an external reviewer's changes request on GitHub, or merge by hand.

## What is enforced

| Rule | Status | Notes |
|---|---|---|
| The gate status is `success` on the exact head, the branch is up to date | enforced by `merge` (and the ruleset) | |
| No unresolved review thread, from any author; `unknown` refuses | enforced by `merge`, from `pr-wait` | Ceiling: 100 threads |
| No external reviewer pending or asking for changes on the head | enforced by `merge`, from `pr-wait` | Reviewers are found from their activity; one that only comments and never reacts or reviews is invisible until it does, and one comment is read as its status note, so it waits 15 minutes |
| A review of the head: the own `pr-reviewer` verdict, or a named `result` | enforced by `merge` | Every trusted account's last verdict must be ready |
| A reviewer ran, was independent of the author, and an external result says what the agent says it does | **not verifiable** | The review is posted with the agent's own credentials in standard mode, and a result is read by the agent: `merge` proves where and when it was posted. High-assurance mode: [SECURITY.md](SECURITY.md#two-ways-to-run) |
| A review was not edited afterwards by the account that wrote it | **not verifiable** | `merge` reads the body as it is now |
| Findings are fixed and answered with a reason | convention | Only the threads are gated; a finding left in a review body is not. A finding rejected without a fix, about security, data or correctness, gets a `pr-reviewer` pass on the head |
| The owner is asked before an inline (non-independent) review is the only one | convention | The skill and the action map say so |

Owner exceptions are explicit: dismissing a review on GitHub, and merging by hand. Admin rights and a hand-posted gate status are
outside what these scripts can check ([SECURITY.md](SECURITY.md)).
