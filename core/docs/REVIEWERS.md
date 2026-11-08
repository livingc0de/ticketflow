# Reviewers

Every pull request gets a second pair of eyes before it merges. If you already use a review bot, or a teammate looks at your pull
requests, TicketFlow notices and waits for them; you configure nothing. If nobody reviews, TicketFlow's own `pr-reviewer` role does,
with no setup. When each review happens: [WORKFLOW.md](WORKFLOW.md).

## pr-reviewer

An independent review by the `pr-reviewer` role (read-only; standard model class unless the tier asks for strong, see [WORKFLOW.md](WORKFLOW.md)). One pass produces separate specification-compliance and code-quality assessments. It checks, in order: acceptance criteria, security
and data, correctness and tests, money and legal logic, the repo's own rules, UI evidence, process (a `Planning:` skip without its four
reasons, a plan claim without a committed plan file, a closing keyword, out-of-scope changes) and over-engineering. It posts one submitted GitHub review on the exact head (format recommended, not required) and reports its conclusions and findings directly to the agent that asked, which acts on the report. When a later push needs a new review, it reviews the delta since
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

- **Who counts.** Any app (a `[bot]` login, or an account of type Bot) that comments, reviews, leaves an inline review comment, or reacts on the pull request
  (reactions on the pull request itself, not on its comments), whatever it writes; or an owner, member or collaborator that reviewed it or left an inline comment on the exact head. No keyword decides: a deploy or coverage bot is listed too, and the agent, which reads every result, ignores what is not a
  review. Inline comments on older commits cannot start a new review round. The author of the pull request and the account running the script never count, nor a human who only left a PR-level comment.
- **Push time.** Only activity after the head was pushed counts. That is the time of its first Actions run, else its committer date
  (a commit made long before it was pushed can then admit older activity: a documented ceiling). Activity before the push, and reviews of
  another commit, decide nothing. A review of the head itself always counts, whatever its time: it can only exist after the push.
- **Start.** A reviewer has started when it has a sign on the head: a review of it, a PR-level or inline comment or a reaction made after the push, or a
  comment edited after it. Its start is its first sign.
- **Result.** A review of the head; else the account's latest PR-level or current-head inline comment with visible text, counted at its last edit. A reaction is
  a sign, never a result. Its first comment on this head (a new comment, or its summary comment edited after the push) can be the
  whole result, so it is shown at once, as `result first comment`, while it is unchanged and the 15 minutes run: it may also be the
  status note of a review still running. To use a completed first comment before the 15-minute window expires, the agent must inspect the full content, act on every finding, and pass both `--reviewed-by '<login>'` and `--review-result-url '<exact comment link>'`. The merge script checks the evidence URL against the current head, but cannot verify the agent's semantic judgment; otherwise it waits for another answer. Concurrent runs in one checkout serialize shared-cache updates and replace the cache atomically; an unavailable or malformed cache is ignored, which loses only prior observation and never turns a review into an accepted result. The runs in one checkout
  share what they saw (a file in the git dir, never committed), so `merge`'s own check knows an edit the wait already saw as the
  answer; without it (another machine, another worktree, or a fresh clone) a reused summary stays unconfirmed up to 15 minutes after
  its last edit. A status note the bot edits again while its review runs reads as an answer (documented limit).
  When it is only a status note, wait again with `--more '<login>'`: the edit of that comment or a review after that is the result,
  within the same 15 minutes (a slow run ends `late`, and `pr-reviewer` takes over). A PR-level comment naming only
  older commits is a sign, never a result; an inline comment attached by GitHub to the current head stays valid even if it mentions
  an older commit. A bot whose only head activity is a reaction, or a PR-level comment naming only other commits, can therefore keep
  merge pending for up to 15 minutes from its first sign; the window does not
  restart. It ends only that reviewer's own wait; another account's "looks good" neither starts nor ends it.
- **Window.** At most 15 minutes from its start, not from its latest edit. After that it is `late` and the wait moves on without it.
  A reviewer that said more is coming: `pr-wait.mjs <PR> --more '<login>'` counts only what it posts after that run started.
- **Changes requested.** A last review of the head that asks for changes ends the wait at once and is a refusal for `merge`.

`pr-wait` prints one `Review <login>: ...` line per such reviewer (`pending since ...`, `result <review STATE | comment | inline comment | first comment> <link> <first line>`,
`changes requested (<sha7>) <link>`, `no result 15 min after its start ...`), then one summary: `Review: pending (<logins>)`, else
`changes requested (<logins>)`, else `results (<logins>)`, else `none`, with `(no result in time: <logins>)` after results or none. A read
that fails prints `Review: pending (the review activity could not be read)`. CI red does not stop the wait for a reviewer that started
(all fixes go into one push); with nobody started it returns at once. A result says that a reviewer answered, never that it approved:
the agent reads the link: an error or quota note is no result, and a status note means wait again with `--more`.

In pull request mode (not `--ci-only`, not a sha) it also prints `Unresolved threads: <n | unknown>`, then up to 20 lines `  [<thread id>] <path>:<line> @<author>
<first line>` for the unresolved review threads **of any author**. `unknown` means the read failed or there are more than 100. The separate `Observed reviewer wait_ms:` line is measured time spent in this invocation observing pending reviewers, not the full external review duration or CI time.
Answer and resolve each with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (the reply on stdin: the fix commit, or the
reason for rejecting it). `pr-wait` flattens all GitHub text to one line, so it cannot forge a summary line.

## What merge needs

`merge` checks, on the exact PR head: a green verification gate, an up-to-date base, no unresolved review threads, no pending external reviewer or native GitHub `CHANGES_REQUESTED` state, and review evidence:

- **Internal review:** a submitted GitHub review by the merging account, attached to the exact head, whose first line is the marker `Reviewed head: <sha> by pr-reviewer: ready to merge` (sha: 7 to 40 hex, a prefix of the head). The `pr-reviewer` role posts it, or a lead relays the role's report word for word; the rest of the body is free text and never parsed. A trusted account's marked review on the head that names another commit or says `changes needed` blocks every lane, and a later `ready to merge` marker on the same head replaces it.
- **External review:** `--reviewed-by '<login>'` names an independent reviewer whose result `pr-wait` observed on this head. An unedited first comment during the waiting window also requires `--review-result-url '<link>'` so the agent explicitly confirms which result it read.
- **Self-check:** `--self-checked` names the account's review of the exact head, with freeform content, and works only where the diff qualifies under `risk.mjs`.

**Agent responsibility:** read the complete review, fix or explicitly reject each finding, and do not merge while blockers remain. GitHub's structured `CHANGES_REQUESTED` state is a hard block; a review posted with `COMMENTED` is evidence of a review, **not proof of approval**. The merge script cannot reliably infer semantic approval from prose, and does not try. Repository-required approvals remain enforceable through GitHub's branch protection.

The review layout below is helpful for readability but is **not a parsing contract**. `merge` reads no repository permission: GitHub's own branch rules decide who may merge.

## The self-check lane

A small, low-risk change does not need a second pair of eyes; it needs proof that it is small and low-risk, and `merge` computes that
from the diff, not from the agent's word. `node core/scripts/risk.mjs <PR>` prints `Lane: self-check` or `Lane: review`, with a `Reason:` line
per rule that forces a review. `merge --self-checked` runs the same function (`core/lib/risk.mjs`). The lane is `review` when:

- `review.self_check` is `false`, the PR names no `Ticket #N` (in its title or body; a named pull request is no ticket), or any named ticket has a `Security` or a `Needs: ...` label, or a `Tier: Critical` label (a `Tier: High` label needs a review of an earlier head first: see below; a ticket without a `Tier:` label counts as Normal, and the highest label of the named tickets wins);
- a changed path (or the old path of a rename) matches the built-in floor (`.github/workflows/`, `.ticketflow/`, `.env` files, the agents' rule, permission and plugin folders, `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, `gemini-extension.json`, the Copilot instruction files and folders under `.github/`) or
  `review.always_review` (your paths, added to the defaults: dependency files and lockfiles, `migrations/`, `.sql`; add your auth and money paths, and the whole runtime of a repo where it is not `.ticketflow/`);
- the non-test, non-docs files exceed `review.self_check_max_files` or `review.self_check_max_lines`, or changed more code lines than
  `review.self_check_untested_lines` with no test file touched. Tests and docs never count toward the size, deleted test lines included
  (a renamed file counts as test or docs only when both of its names are);
- the file list is incomplete or a code file has no readable line count (binary, empty or mode-only changes; in the fix delta this holds for every file). Known limit: a binary that was renamed and changed can report no line count and look like a pure rename.

**Fix delta.** If the only reasons to require a review are size-related, a small fix delta since a previously submitted non-blocking internal review can be self-checked. GitHub's commit ID establishes which head a review sits on; the marker must agree with it. The base is the account's latest marked review of an earlier head, which must be ready, completed and name its own commit; a review without the marker is no base. A native `CHANGES_REQUESTED` or a `changes needed` marker on the earlier review cannot be answered by a self-check: a new review is required.

The self-check is a submitted GitHub review on the exact head, usually posted in this suggested format:

```text
Self-check head: <sha7>
Acceptance criteria: each checked with evidence
Invariant sweep: relevant requirements and edge cases checked
Not checked: what could not be verified, if anything
```

No exact wording is required. The agent passes `merge --self-checked` as its explicit attestation, and TicketFlow independently verifies the diff's low-risk criteria. The script cannot determine how carefully the review was performed; meaningful review and judgment remain the agent's responsibility.

A High tier requires an earlier review before a small fix delta can be self-checked. Critical tier always requires a review. These floors are still enforced, but changing a review's natural-language formatting cannot make it ineligible.

## When merge says no

Every refusal names its reason and the next step.

| `merge` says | What it means | What to do |
|---|---|---|
| `N unresolved review thread(s)` | A review thread, from anyone, is still open | Fix it, or reject it with a reason. Reply and resolve it with `thread.mjs` (the reply on stdin), then push once if code changed |
| `unresolved review threads: unknown` | The threads could not be read, or there are more than 100 | Resolve what is open on the pull request, run `pr-wait` again |
| `changes requested (<logins>)` | An external reviewer's last review of this commit asks for changes | Fix and push (the new head is reviewed again), or, as the owner, dismiss the review on GitHub |
| `pending (<logins>)` ... `has not answered` | A reviewer started on this head and has not answered yet | Wait (`pr-wait`), at most 15 minutes from its start |
| `pending (the review activity could not be read)` | A GitHub read failed | Run again |
| `<login> has no result on <sha7>` | `--reviewed-by` names an account `pr-wait` did not list with a result on this head (another head, no activity, this account or the author) | Name the right account, or run `pr-reviewer` |
| `<login> requested changes` | GitHub's native review state is `CHANGES_REQUESTED` on this head | Address the findings; ask that reviewer to re-review, or the owner may dismiss the request |
| `self-check is off in this repo` / `no submitted self-check` | Self-checks are disabled, or the account has no submitted nonempty review of this head | Run `pr-reviewer`, or submit a self-check review with evidence |
| `this PR needs a review, not a self-check (<reasons>)` / `too big for a self-check` / `fix delta ... lines` | `risk.mjs` found a rule that forces a review, or the fix delta is too big | Run `pr-reviewer` on the head (a delta review since the last one is enough) |
| `no pr-reviewer review marked for <sha7>` | The merging account has no review on the exact head whose first line is the marker | Post the `pr-reviewer` report (or its own review) with the printed first line, or name a reviewer or use `--self-checked` |
| `<login>'s pr-reviewer review on <sha7> names <other>` | A trusted account's marked review sits on this head but names another commit | Get a review of the head (a delta review since the named commit is enough) |
| `<login>'s pr-reviewer review of <sha7> says changes needed` | A trusted account's latest marked review on this head says `changes needed` | Fix and push, then get a delta review; a later `ready to merge` marker on the same head also replaces it |
| `<base> moved (behind by n)` | The default branch has new commits (checked early and again right before the merge) | `gh pr update-branch <PR>`, wait for the new gate, review the new head, merge again |
| `CI / Gate is ... on <sha7>` | The gate is not green on this exact commit | Wait for it or fix what failed ([CI-GATE.md](CI-GATE.md)) |

An agent never lifts any of these on its own, and the script has no flag to skip a check. A `pr-reviewer` review is re-reviewed by posting a new marked review of the new head. GitHub's native changes requests can be dismissed by the owner, or the owner may merge by hand.

## What is enforced

| Rule | Status | Notes |
|---|---|---|
| The gate status is `success` on the exact head, the branch is up to date | enforced by `merge` (and the ruleset) | |
| No unresolved review thread, from any author; `unknown` refuses | enforced by `merge`, from `pr-wait` | Ceiling: 100 threads |
| No external reviewer pending or asking for changes on the head; a named reviewer's answer is not an unconfirmed first comment | enforced by `merge`, from `pr-wait` | Reviewers are found from their activity (any app, any wording); whether a comment is a review is the agent's reading |
| A review of the head: the own marked `pr-reviewer` review, or a named external result | enforced by `merge` | The marker's sha must be a prefix of the head and its verdict ready; native changes requests and `changes needed` markers block; the agent judges the findings |
| The 15-minute wait for a started reviewer is measured on GitHub's clock | enforced by `pr-wait` with a limit | The clock is read once from the `Date` header of a GitHub call (when it cannot be read, or reads later than the machine clock, the machine clock), so a machine clock that runs ahead of GitHub's does not shorten the window. A reviewer timestamp still ahead of that clock counts from the moment `pr-wait` first sees it (it prints a `Clock:` note); with `--more`, what a reviewer posted or edited after the run started is then a change against the first look. If GitHub's own object timestamps disagree with its `Date` header in the other direction (they read older), the window ends early and nothing in the clocks shows it |
| A reviewer ran, was independent of the author, and an external result says what the agent says it does | **not verifiable** | The review is posted with the agent's own credentials in standard mode, and a result is read by the agent: `merge` proves where and when it was posted. High-assurance mode: [SECURITY.md](SECURITY.md#two-ways-to-run) |
| A self-check is only used on a small, low-risk diff | enforced by `merge`, from the diff | Floor from facts only: size, untested code, paths, labels. It cannot judge design or the care of the self-check, and it reads the tier only from the `Tier: High` / `Tier: Critical` labels |
| A marked review means the code is safe to merge, or that the role wrote it | **not verifiable** | The marker is a format and traceability check: the same account can write it. The agent must understand the findings; GitHub reviews and branch rules enforce only the structured facts |
| Findings are fixed and answered with a reason | convention | Only the threads are gated; a finding left in a review body is not. A finding rejected without a fix, about security, data or correctness, gets a `pr-reviewer` pass on the head |
| The owner is asked before an inline (non-independent) review is the only one | convention | The skill and the action map say so |

Owner exceptions are explicit: dismissing a review on GitHub, and merging by hand. Admin rights and a hand-posted gate status are
outside what these scripts can check ([SECURITY.md](SECURITY.md)).
