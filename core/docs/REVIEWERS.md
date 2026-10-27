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

A review round starts at the pull request's creation, or at the latest comment starting with `rereview_comment`. For each reviewer,
in this order, the first that holds decides:

1. **changes requested**: its **last** review on exactly the head commit (reviews that are dismissed or still pending do not count)
   is `CHANGES_REQUESTED`. A later review of the same head replaces it.
2. **done**: its last such review is any other state (approved or commented); or it left `no_findings_reaction` after both the head
   commit and the round start; or the **last** match of `done_pattern` across its issue comments (bodies as currently edited, ordered
   by last update) captures a `sha` of 7 or more hex characters that is a prefix of the head.
3. **unavailable**: a comment of the account since the round started matches `unavailable_pattern`.
4. **silent**: `stale_after_min` minutes passed since the later of the round start and the head commit.
5. otherwise **pending**.

`pr-wait` prints one `Review:` line: `pending` while any reviewer is pending, else `changes requested (<names>)`, else `standin needed
(<names>)` when some are unavailable or silent, else `done`. A reviewer who requested changes has answered, so the wait ends; `merge`
refuses until they review the new head or the owner dismisses the review. With no reviewers configured it prints `Review: none
configured (pr-reviewer reviews)`.

In pull request mode (not `--ci-only`, not a sha), configured or not, `pr-wait` also prints `Unresolved threads: <n | unknown>`,
then up to 20 lines `  [<thread id>] <path>:<line> @<author> <first line>` for the unresolved review threads **of any author**. `unknown`
means the read failed or the pull request has more than 100 threads. Answer and resolve each with
`node .ticketflow/scripts/thread.mjs <PR> <thread-id>` (the reply on stdin: the fix commit, or the reason for rejecting it).

`done_pattern` is for a bot that posts no review when it has no findings, and instead keeps one summary comment that it edits in
place, with a machine line such as `review-state:v1 {"code_review":{"commit_sha":"<40-hex>","status":"completed"}}` (key order not
guaranteed). An order-independent pattern for that line (a JSON string, so backslashes are doubled):

```json
{ "name": "bot", "login": "review-bot[bot]",
  "done_pattern": "review-state:v1 (?=[^\\n]*\"commit_sha\":\"(?<sha>[0-9a-f]{7,40})\")(?=[^\\n]*\"status\":\"completed\")" }
```

A state still `running`, or naming an older commit, does not match the head, so the reviewer stays pending. Match `completed` only:
a run that `failed` reviewed nothing. Put the failure wording in `unavailable_pattern` instead, so a stand-in takes over. (Before 0.3.0
this example also accepted `failed`: remove `|failed` from a copy.)

## Stand-in and review basis

- **Reviewer configured and done**: nothing more is needed unless the pull request is `high` or `critical`, which also gets a
  `pr-reviewer` pass.
- **`standin needed`**: dispatch `pr-reviewer` in stand-in mode (the brief says so; it lists nits too and gives every item a fix),
  unless it already reviewed this head.
- **`none configured`**: the `pr-reviewer` review from when the pull request opened is the one.

In both of the last two cases `merge` needs a basis, because no external reviewer finished. Post a comment on the pull request and
pass its id as `--review-basis`. It starts with `Review basis for <sha7>:` (the first 7 characters of the head) and then has exactly one of:

- a link to the `pr-reviewer` review: `Review basis for <sha7>: <why>, reviewed by pr-reviewer <review URL>; since then: <trivial fixes or none>`.
  The URL is `.../pull/<PR>#pullrequestreview-<id>`. `merge` reads that review from the pull request's own list: it must be the
  **newest** `pr-reviewer` review of the pull request (a later `changes needed` defeats an older `ready to merge`), submitted as
  COMMENTED or APPROVED (not pending or dismissed), start with `Reviewed head: <sha>` where `<sha>` prefixes the commit it was posted
  on (a review gathered before a force-push is refused), have exactly one `**Verdict:**` line whose value is exactly `ready to merge`,
  and be on the head or an ancestor of it (a force-push needs a new review);
- `owner approved` right after the colon (for example `Review basis for <sha7>: owner approved the setup PR`): the owner's decision,
  used for the setup and update pull requests of `init` and `sync`. `merge` accepts it and says so in its output.

Only accounts that GitHub reports as `OWNER`, `MEMBER` or `COLLABORATOR` count: the basis comment, the linked review and every
`pr-reviewer` verdict. On a public repository anyone can comment or post a review, so an outsider's review can neither lift a
`changes needed` nor serve as a basis (and cannot stop a merge either).

`merge` also looks at the `pr-reviewer` reviews of the head, whichever path got there (a `pr-reviewer` review is a submitted review of
such an account with a `**Verdict:**` line, in any formatting of the rest). The last one must have exactly one verdict line, and its value
must be exactly `ready to merge`: `changes needed`, the unfilled template `ready to merge | changes needed`, two verdict lines or
anything else stops the merge. So `pr-reviewer` keeps its first line and its `Verdict` line exact. `pr-wait` and `merge` print and read
the summary lines (`Review:`, `Unresolved threads:`) from text that includes GitHub content: `pr-wait` flattens that text to one line
and `merge` accepts exactly one of each line.

## What is enforced

| Rule | Status | Notes |
|---|---|---|
| The gate status is `success` on the exact head, the branch is up to date | enforced by `merge` (and the ruleset) | |
| No unresolved review thread, from any author; `unknown` refuses | enforced by `merge`, from `pr-wait` | Ceiling: 100 threads |
| No configured reviewer has `CHANGES_REQUESTED` on the head | enforced by `merge`, from `pr-wait` | The reviewer's last review of the head wins |
| The last `pr-reviewer` review of the head says exactly `ready to merge` | enforced by `merge` | Reviews of OWNER, MEMBER or COLLABORATOR accounts only |
| A basis is `owner approved`, or the newest `pr-reviewer` review: `ready to merge`, on the head or an ancestor | enforced by `merge` | The comment and the review must be of such an account |
| A reviewer ran, and was independent of the author | **not verifiable** | The review and the basis are posted with the agent's own credentials: `merge` proves which review was named and what it says, not who wrote it |
| `owner approved` really came from the owner | **not verifiable** | Anyone with the agent's credentials can post it |
| A review was not edited afterwards by the account that wrote it | **not verifiable** | `merge` reads the body as it is now |
| Findings are fixed and answered with a reason | convention | Only the threads are gated; a finding left in a review body is not |
| The owner is asked before an inline (non-independent) review is the only one | convention | The skill and the action map say so |

Owner exceptions are explicit: `owner approved` for a basis, and dismissing a review on GitHub. Admin rights and a hand-posted gate
status are outside what these scripts can check ([SECURITY.md](SECURITY.md)).
