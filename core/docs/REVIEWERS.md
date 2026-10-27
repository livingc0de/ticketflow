# Reviewers

Two kinds: the `pr-reviewer` role (always available) and any number of external reviewers, which are accounts you list in the
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

1. **done**: it left a review on exactly the head commit; or it left `no_findings_reaction` after the head commit; or the **last**
   match of `done_pattern` across its issue comments (bodies as currently edited, ordered by last update) captures a `sha` of 7 or
   more hex characters that is a prefix of the head.
2. **unavailable**: a comment of the account since the round started matches `unavailable_pattern`.
3. **silent**: `stale_after_min` minutes passed since the later of the round start and the head commit.
4. otherwise **pending**.

`pr-wait` prints one `Review:` line: `pending` while any reviewer is pending, `standin needed (<names>)` when none is pending but some
are unavailable or silent, else `done`. It also lists the account's inline comments since the round started. With no reviewers
configured it prints `Review: none configured (pr-reviewer reviews)`.

`done_pattern` is for a bot that posts no review when it has no findings, and instead keeps one summary comment that it edits in
place, with a machine line such as `review-state:v1 {"code_review":{"commit_sha":"<40-hex>","status":"completed"}}` (key order not
guaranteed). An order-independent pattern for that line (a JSON string, so backslashes are doubled):

```json
{ "name": "bot", "login": "review-bot[bot]",
  "done_pattern": "review-state:v1 (?=[^\\n]*\"commit_sha\":\"(?<sha>[0-9a-f]{7,40})\")(?=[^\\n]*\"status\":\"(?:completed|failed)\")" }
```

A state still `running`, or naming an older commit, does not match the head, so the reviewer stays pending.

## Stand-in and review basis

- **Reviewer configured and done**: nothing more is needed unless the pull request is `high` or `critical`, which also gets a
  `pr-reviewer` pass.
- **`standin needed`**: dispatch `pr-reviewer` in stand-in mode (the brief says so; it lists nits too and gives every item a fix),
  unless it already reviewed this head.
- **`none configured`**: the `pr-reviewer` review from when the pull request opened is the one.

In both of the last two cases `merge` needs an attestation, because no external reviewer finished: post a comment on the pull request
and pass its id as `--review-basis`:

`Review basis for <sha7>: <why>, reviewed by pr-reviewer <review URL> on <sha7'>; since then: <trivial fixes or none>`

`merge` checks that the comment is on this pull request and names the first 7 characters of the head. The comment is made by the
agent: it is bound to the head but cannot prove that a reviewer ran ([SECURITY.md](SECURITY.md)).
