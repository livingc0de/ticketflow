# Reviewers

Every pull request gets a second pair of eyes before it merges. Out of the box that is TicketFlow's own `pr-reviewer` role, an
independent reviewer that needs no setup. If you already use a review bot or want a person to review, add them here; TicketFlow
waits for them, notices when they are out of quota or silent, and brings in the built-in reviewer as a stand-in.

Reviewers come in two kinds: the `pr-reviewer` role (always available) and any number of external reviewers, which are accounts you list in the
config. `pr-wait` reads the external ones; `merge` enforces the result. When each reviews: [WORKFLOW.md](WORKFLOW.md).

## pr-reviewer

An independent review by the `pr-reviewer` role (strong model class, read-only). It checks, in order: acceptance criteria, security
and data, correctness and tests, money and legal logic, the repo's own rules, UI evidence, process (a `Planning:` skip without its four
reasons, a plan claim without a committed plan file, a closing keyword, out-of-scope changes) and over-engineering. It posts exactly
one review comment whose first line is `Reviewed head: <sha7>`, and reports its verdict, the review URL and one line per finding.
It never pushes, commits, edits or approves. Add repo lenses in `.ticketflow/custom/pr-reviewer.md` and in the AGENTS.md
"Review Guidelines" ([EXTENDING.md](EXTENDING.md)).

Without sub-agents (the generic action map) it runs inline in the same session. An inline review is not independent, so the owner is
asked before merging on it.

## External reviewers

`reviewers` in the config is a list of these objects. A reviewer is a GitHub account (a bot or a person); `pr-wait` reads its
reviews, issue comments and reactions on the pull request.

| Key | Type | Default |
|---|---|---|
| `name` | string | required |
| `login` | GitHub login of the reviewing account, for example `review-bot[bot]` | required |
| `rereview_comment` | string a re-review is requested with, or `null` | `null` |
| `no_findings_reaction` | a GitHub reaction content (`+1`, `-1`, `laugh`, `confused`, `heart`, `hooray`, `rocket`, `eyes`) the account leaves when it has no findings, or `null` | `null` |
| `unavailable_pattern` | regex (case-insensitive) matched against the account's issue comments to detect "out of quota", or `null` | `null` |
| `done_pattern` | regex with a named group `sha`, or `null` | `null` |
| `stale_after_min` | integer minutes after which a silent reviewer no longer blocks, or `null` | `null` |

A review round starts at the pull request's creation, or at the latest comment starting with `rereview_comment` by an `OWNER`,
`MEMBER` or `COLLABORATOR` (on a public repository anyone can comment, and an outsider's comment must not restart the round). For
each reviewer, in this order, the first that holds decides:

1. **changes requested**: its **last** review on exactly the head commit (reviews that are dismissed or still pending do not count)
   is `CHANGES_REQUESTED`. A later review of the same head replaces it.
2. **approved**: its last such review is `APPROVED`.
3. **commented**: its last such review is any other state (`COMMENTED`, or one this version does not know). A comment reports
   findings, it does not accept them, even with no inline thread, so a stand-in decides. A review of the head always decides before
   items 4 to 6: a later reaction or state comment does not turn it into done.
4. **done**: with no review of the head, it left `no_findings_reaction` after both the head commit and the round start; or the **last** match of
   `done_pattern` across its issue comments (bodies as currently edited, ordered by last update) captures a `sha` of 7 or more hex
   characters that is a prefix of the head. Both must be a signal of *no findings*, never only of "finished".
5. **unavailable**: a comment of the account since the round started matches `unavailable_pattern`.
6. **silent**: `stale_after_min` minutes passed since the later of the round start and the head commit.
7. otherwise **pending**.

`pr-wait` prints one `Review:` line: `pending` while any reviewer is pending, else `changes requested (<names>)`, else `standin needed
(<names>)` when some are unavailable, silent or only commented, else `done`. A reviewer who requested changes has answered, so the wait ends; `merge`
refuses until they review the new head or the owner dismisses the review. With no reviewers configured it prints `Review: none
configured (pr-reviewer reviews)`.

In pull request mode (not `--ci-only`, not a sha), configured or not, `pr-wait` also prints `Unresolved threads: <n | unknown>`,
then up to 20 lines `  [<thread id>] <path>:<line> @<author> <first line>` for the unresolved review threads **of any author**. `unknown`
means the read failed or the pull request has more than 100 threads. Answer and resolve each with
`node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (the reply on stdin: the fix commit, or the reason for rejecting it).

`done_pattern` is for a bot that posts no review when it has no findings, and instead keeps one summary comment that it edits in
place, with a machine line such as `review-state:v1 {"code_review":{"commit_sha":"<40-hex>","status":"completed","has_any_findings":false}}`
(key order not guaranteed). It must match only a *clean* state: a finished run with findings is not an acceptance. An
order-independent pattern for that line, with every condition scoped to the one object (`[^}]*`, so another object's key such as
`security_review` cannot satisfy it; a JSON string, so backslashes are doubled):

```json
{ "name": "bot", "login": "review-bot[bot]",
  "done_pattern": "review-state:v1 [^\\n]*\"code_review\":\\{(?=[^}]*\"commit_sha\":\"(?<sha>[0-9a-f]{7,40})\")(?=[^}]*\"status\":\"completed\")(?=[^}]*\"has_any_findings\":false)" }
```

A state still `running`, naming an older commit, or reporting findings does not match the head, so the reviewer stays pending until
it reviews or a stand-in takes over. Match `completed` only: a run that `failed` reviewed nothing. Put the failure wording in
`unavailable_pattern` instead. (Before 0.3.0 this example also accepted `failed`: remove `|failed` from a copy. Copies that accept
`completed` alone also accept a run with findings: add the `has_any_findings` condition.)

GitHub keeps one reaction per account and content, so a reviewer cannot leave the same `no_findings_reaction` a second time: after a
new push its old reaction is not "after the head", and a clean second round shows as a state comment or a review instead.

## Stand-in and review basis

- **Reviewer configured and done**: nothing more is needed unless the pull request is `high` or `critical`, which also gets a
  `pr-reviewer` pass.
- **`standin needed`**: a reviewer is unavailable, silent or **only commented**. Dispatch `pr-reviewer` in stand-in mode (the brief
  says so; it lists nits too and gives every item a fix), unless it already reviewed this head after the reviewer's comment. For a
  reviewer that only commented, the brief carries that review and all its threads, resolved ones too: the stand-in weighs them, and a
  finding that was rejected without a fix, and that it disagrees with, is a blocker.
- **`none configured`**: the `pr-reviewer` review from when the pull request opened is the one.

In both of the last two cases `merge` needs a basis, because no external reviewer finished. Post a comment on the pull request and
pass its id as `--review-basis`. It starts with `Review basis for <sha7>:` (the first 7 characters of the head) and then has exactly one of:

- a link to the `pr-reviewer` review: `Review basis for <sha7>: <why>, reviewed by pr-reviewer <review URL>`.
  The URL is `.../pull/<PR>#pullrequestreview-<id>`. `merge` reads that review from the pull request's own list: it must be the
  **newest** `pr-reviewer` review of the pull request (a later `changes needed` defeats an older `ready to merge`), submitted as
  COMMENTED or APPROVED (not pending or dismissed), start with `Reviewed head: <sha>` where `<sha>` prefixes the commit it was posted
  on (a review gathered before a force-push is refused), have exactly one `**Verdict:**` line whose value is exactly `ready to merge`,
  and be posted on **exactly the head**: after any push, an update-branch included, the basis needs a new review (a delta review
  since the previous one is enough, so it stays cheap);
- `owner approved` right after the colon (for example `Review basis for <sha7>: owner approved the setup PR`): the owner's decision,
  used for the setup and update pull requests of `init` and `sync`. It must come from an account with `admin` permission (the
  owner's). `merge` accepts it and says so in its output, naming the account.

Only accounts that GitHub reports as `OWNER`, `MEMBER` or `COLLABORATOR` count, and `merge` then reads the account's repository
permission (`collaborators/<login>/permission`): a ready `pr-reviewer` verdict on the head and a link basis need `admin` or `write`,
`owner approved` needs `admin`. `MEMBER` is any member of the owning organization and `COLLABORATOR` includes read-only access, which
is why the permission is read: a read-only account can neither lift a `changes needed` with a later `ready to merge` nor serve as a
basis. A failed read, an account without a login (deleted) and an agent on a GitHub App account (permission `none`) are refused.
`changes needed` from any of the trusted associations still blocks. On a public repository anyone can comment or post a review,
so an outsider's review can neither lift a `changes needed` nor serve as a basis, and it does not set a verdict. An outsider's
unresolved review thread still blocks the merge (any author counts): answer it with a reason and resolve it with `thread.mjs`; for
a flood, use GitHub's interaction limits or lock the conversation first, then resolve with a reason.

`merge` also looks at the `pr-reviewer` reviews of the head, whichever path got there (a `pr-reviewer` review is a submitted review of
such an account with a verdict line; the label may be spelled `**Verdict:**`, `**Verdict**:`, `Verdict:`, indented or in any case, so a
`changes needed` is never missed). The last one must have exactly one verdict line, and only the exact line `**Verdict:** ready to merge`
is ready: `changes needed`, the unfilled template `ready to merge | changes needed`, two verdict lines or
anything else stops the merge. So `pr-reviewer` keeps its first line and its `Verdict` line exact. `pr-wait` and `merge` print and read
the summary lines (`Review:`, `Unresolved threads:`) from text that includes GitHub content: `pr-wait` flattens that text to one line
and `merge` accepts exactly one of each line.

## When merge says no

A finished review is not enough: `merge` also wants the findings answered. Every refusal names its reason and the next step. The
usual ones, and the legitimate way past each:

| `merge` says | What it means | What to do |
|---|---|---|
| `N unresolved review thread(s)` | A review comment thread, from anyone (a bot or an outsider too), is still open | Fix it, or decide to reject it and say why. Reply and resolve it with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (the reply on stdin: the fix commit, or the reason), then push once if code changed. `pr-wait` lists the thread ids |
| `unresolved review threads: unknown` | The threads could not be read, or there are more than 100 | Open the pull request, resolve what is open, run `pr-wait` again |
| `changes requested (<names>)` | A configured reviewer's last review of this commit asks for changes | Fix and push, ask that reviewer to look again (post its `rereview_comment`), or, as the owner, dismiss the review on GitHub |
| the last `pr-reviewer` review "has verdict ... not exactly ready to merge" | The built-in reviewer said `changes needed`, or its verdict line is misspelled or still the unfilled template | Fix and push, then run `pr-reviewer` again on the new head. Or, if the finding is wrong, run `pr-reviewer` again on the same head and give the reason; its newest review counts |
| `standin needed (<names>)` | A reviewer only commented on this commit (a comment is not an approval), or is unavailable or silent | Dispatch `pr-reviewer` in stand-in mode (with the commenting reviewer's review and threads), then post the basis as below |
| `review is "pending"` | A configured reviewer has not answered on this commit yet | Wait (`pr-wait` does it in the background), post the reviewer's `rereview_comment`, or set `stale_after_min` so a silent reviewer is replaced by a stand-in |
| `no reviewer finished` | No external reviewer answered (`standin needed` or `none configured`), so `merge` wants a review basis | Run `pr-reviewer` on this head, then post `Review basis for <sha7>: <its review URL>` and pass the comment's id as `--review-basis`. When you decided yourself, the comment says `Review basis for <sha7>: owner approved ...` |
| a basis `comment ... must ...` / `is not from the owner, a member or a collaborator` / `a later pr-reviewer review exists` | The basis is in the old format, comes from an outsider, links an old review or links a review of another commit | Post a new basis that links the **newest** `ready to merge` review of this pull request, made by an owner, member or collaborator account |
| `review ... is on <sha>, not the head <sha>` | The basis links a review of an older commit: any push since, an update-branch included, moved the head | Run `pr-reviewer` on the head (a delta review since its last one is enough), then post a new basis |
| `... has <permission> access: ... needs write access` / `only an admin account can approve for the owner` | A verdict, a basis or an `owner approved` came from an account without the needed repository permission | Post it again from an account with write access; `owner approved` from an admin (the owner's) account |
| `<base> moved (behind by n)` | The default branch has new commits (checked early, and again right before the merge) | `gh pr update-branch <PR>`, wait for the new gate, run `pr-reviewer` on the new head if a basis is needed, then merge again |
| `CI / Gate is ... on <sha7>` | The gate is not green on this exact commit | Wait for it or fix what failed ([CI-GATE.md](CI-GATE.md)) |

What only the owner can do, and what it does not do:

- `owner approved` in a basis only replaces a missing external review. It does not lift an open thread, a reviewer's `changes
  requested`, or a `changes needed` from `pr-reviewer` on the head, which are checked first.
- A configured reviewer's `changes requested` can be dismissed on GitHub.
- The owner can always merge the pull request by hand on GitHub.

An agent never does any of these on its own, and the script has no flag to skip a check.

A `pr-reviewer` review is a comment, and GitHub cannot dismiss a comment. A `changes needed` that is wrong is answered by running
`pr-reviewer` again on the head with the reason: its newest review counts. The agent or the owner can do that.
If you copied a basis comment from the 0.2.0 docs on a pull request that was already open, post it again in the format above.

## What is enforced

| Rule | Status | Notes |
|---|---|---|
| The gate status is `success` on the exact head, the branch is up to date | enforced by `merge` (and the ruleset) | |
| No unresolved review thread, from any author; `unknown` refuses | enforced by `merge`, from `pr-wait` | Ceiling: 100 threads |
| No configured reviewer has `CHANGES_REQUESTED` on the head | enforced by `merge`, from `pr-wait` | The reviewer's last review of the head wins |
| A configured reviewer accepted the head: `APPROVED`, or a no-findings reaction or state | enforced by `merge`, from `pr-wait` | A review that only commented (even with no thread) needs a stand-in and a basis |
| The last `pr-reviewer` review of the head says exactly `ready to merge` | enforced by `merge` | Reviews of OWNER, MEMBER or COLLABORATOR accounts only, with `write` or `admin` permission |
| A basis is `owner approved`, or the newest `pr-reviewer` review: `ready to merge`, on exactly the head | enforced by `merge` | The comment and the review need `write` access; `owner approved` needs `admin` |
| A reviewer ran, and was independent of the author | **not verifiable** | The review and the basis are posted with the agent's own credentials (standard mode): `merge` proves which review was named and what it says, not who wrote it. High-assurance mode: [SECURITY.md](SECURITY.md#two-ways-to-run) |
| `owner approved` really came from the owner | **not verifiable** | A comment shows which account posted it, not who typed it: with the owner's admin token the agent can post it. High-assurance mode keeps the agent off that token |
| A review was not edited afterwards by the account that wrote it | **not verifiable** | `merge` reads the body as it is now |
| Findings are fixed and answered with a reason | convention | Only the threads are gated; a finding left in a review body is not. A finding rejected without a fix, about security, data or correctness, gets a `pr-reviewer` pass on the head (the skill says so) |
| The owner is asked before an inline (non-independent) review is the only one | convention | The skill and the action map say so |

Owner exceptions are explicit: `owner approved` for a basis, and dismissing a review on GitHub. Admin rights and a hand-posted gate
status are outside what these scripts can check ([SECURITY.md](SECURITY.md)).
