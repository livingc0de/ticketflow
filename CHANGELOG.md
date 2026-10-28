# Changelog

## 0.4.0

### Highlights

- **Review bots and teammates are noticed, not configured.** While CI runs, `pr-wait` watches the pull request for anyone who starts
  reviewing the exact commit (a reaction, a comment, a review) and waits for that reviewer's result, at most 15 minutes from its
  start. Any bot counts, whatever it writes (the agent judges whether its comment is a review), and its result counts as soon as it
  lands: a review, a comment (the first one too) or its edit. Activity from older commits or from humans who only commented is ignored.
  A comment is about another commit only when it contains a standalone 7-40-character hex value that does not name the head. `pr-wait`
  keeps what it saw in `ticketflow-pr-wait.json` in the git dir (never committed, pruned after 2 days), and `merge --reviewed-by` waits on
  a first comment that may be a status note. The `reviewers` config section and its seven keys are gone.
- **The built-in reviewer is the fallback, and it reports straight to the agent.** When no external reviewer started, or none gave a
  usable result, `pr-reviewer` reviews the commit once CI settles (never a red one), and the agent acts on its report instead of
  reading it back from GitHub. It reviews only the delta after a push. `critical` pull requests get it even after an external
  result; a `high` one only where that result missed the risky part.
- **Less merge ceremony, the same guarantees.** The review basis comment, `--review-basis`, `owner approved` and every permission
  lookup are gone. `merge` still needs a green gate on the exact commit, an up-to-date branch, no open thread, no "changes requested",
  `--match-head-commit` and no admin bypass; the review of the commit is the agent's own `pr-reviewer` review, or `--reviewed-by <login>`
  naming the external reviewer whose result it acted on. A started reviewer that has not answered blocks the merge until its result
  or 15 minutes. A "changes needed" verdict is lifted only by the account that wrote it.
- **Asking for a fix or a feature starts a ticket.** "Fix this bug" and "build X" go through `create-ticket` and `implement-ticket`;
  investigations, reviews, audits and local experiments stay ticketless. A `low`-tier ticket has only a goal, acceptance criteria and
  an execution line.
- **Leaner instructions.** The review flow in `implement-ticket`, `pr-reviewer` and `REVIEWERS.md` is shorter, with one home for each rule.

### What you need to do when upgrading from 0.3.5

`schema_version` goes from 1 to 2 (`sync` migrates it: the `reviewers` key is dropped). No GitHub setting changes. The steps by hand:

1. **Review bots.** Nothing to configure any more. If you asked a bot for another look after a fix with `rereview_comment`, TicketFlow no
   longer posts that: add the rule to `.ticketflow/custom/implement-ticket.md` if you want it.
2. **Pull requests that are already open.** `Review basis for ...` comments are ignored. Merge on the account's own `pr-reviewer` review of
   the exact head, or pass `--reviewed-by '<login>'` for the external reviewer whose result you acted on.
3. **Setup and update pull requests** (`init`, `sync`) are reviewed and merged like any pull request, only after you say so in chat. You no
   longer post an approval comment.
4. **Details:** [UPGRADING.md](core/docs/UPGRADING.md#from-035) and [REVIEWERS.md](core/docs/REVIEWERS.md).

## 0.3.5

### Highlights

- **A comment is not an approval.** A reviewer that only comments on the latest commit (many review bots do) no longer counts as
  "done". A stand-in `pr-reviewer` looks at it and the merge needs a review basis, so a blocking remark can no longer slip
  through because it came without an open thread.
- **The review you merge on belongs to the exact commit.** A review basis must link a ready review of the commit that merges. After
  any push, an update-branch too, the review is done again (a short delta review is enough).
- **Trust follows repository permission.** A ready verdict or a link basis needs write access, `owner approved` needs admin. A
  read-only collaborator can no longer lift a block, and an agent that posts as a GitHub App account is refused.
- **Older pull requests are found.** `queue` also follows a ticket's cross-references, so an old merged or open PR is no longer
  mistaken for "not started".
- **The same engineering method with or without a ticket.** "Fix this bug", "review this diff" or "audit the repo" follow it with no
  ticket, branch or PR, and `debt.mjs` lists every deliberate shortcut with the moment to revisit it.
- **Evals you can run.** Maintainers get a small harness and four local scenarios to measure how real agents behave under
  TicketFlow (never installed in your repo; no paid run was made for this release).

### What you need to do when upgrading from 0.3.0

Nothing in your config needs migrating (`schema_version` stays 1), and no GitHub setting changes. The update pull request adds the
stubs of the new `engineering-method` skill, one allow line in `.claude/settings.json` (for `debt.mjs`) and one line in the
`AGENTS.md` block (any code change, review or audit follows that skill, with or without a ticket). The steps by hand:

1. **Pull requests that are already open.** `merge` is stricter now ([REVIEWERS.md](core/docs/REVIEWERS.md#when-merge-says-no)).
   - A reviewer that only commented used to count as done. Now `pr-wait` prints `commented, not approved` and `standin needed`:
     dispatch `pr-reviewer` as a stand-in (with that review and its threads) and post a review basis.
   - A basis must link a ready `pr-reviewer` review posted on the exact head. One that names an older commit is refused: review
     the new head (a delta review is enough) and post the basis again. Re-do this after every push, an update-branch included.
   - The ready verdict and a link basis must come from an account with `write` or `admin` access, and `owner approved` from an
     `admin` account (yours). A read-only collaborator's comment is refused, and so is an agent that posts as a GitHub App account
     (its permission reads `none`): use an account with write access for the agent, or have an admin post the `owner approved` basis.
2. **A copied `done_pattern`.** If you copied the example from the REVIEWERS docs, tighten it: it must also require
   `has_any_findings:false`, with every condition scoped to its own object (`[^}]*`). A copy that accepts `completed` alone also
   accepts a run that has findings. The current example is in [REVIEWERS.md](core/docs/REVIEWERS.md#external-reviewers).
3. **Your `custom/` files.** If one repeats the old test, debug or delegation text of `implement-ticket`, it can go: that text now
   lives in the `engineering-method` skill. A `custom/engineering-method.md` adapts it, like any other skill.
   `.ticketflow/custom/README.md` is written once and never rewritten, so it does not list `engineering-method.md`: add the line by
   hand if you keep that list.
4. **High-assurance mode, optional.** If you want GitHub, not a script, to stop an agent from merging without you, apply the
   ruleset settings of "Two ways to run" in [SECURITY.md](core/docs/SECURITY.md#two-ways-to-run) by hand. No agent writes them.

What you may notice without doing anything: a pull request that merges on a review basis needs a new one after an update-branch,
and `queue` exits 2 for a ticket with more than 100 cross-references instead of guessing.

### Changes

#### Review gate and queue (#38)

- **A comment is not an approval.** A configured reviewer whose last review of the head is `COMMENTED` (or any state other than
  `APPROVED` or `CHANGES_REQUESTED`) now prints `Review <name>: commented, not approved` and the summary `standin needed`, even with
  no thread: a stand-in `pr-reviewer` and a review basis decide. A later reaction or state comment no longer turns it into done.
  Only a re-review request of an `OWNER`, `MEMBER` or `COLLABORATOR` restarts a review round. This repo's Codex `done_pattern` now
  also requires `has_any_findings:false`; a copied pattern that accepts `completed` alone accepts a run with findings too, so add the
  condition (the REVIEWERS example shows it, scoped to its own object).
- **Trust follows repository permission.** A ready `pr-reviewer` verdict on the head and a link basis need an account with `write`
  or `admin` access (a read-only collaborator can no longer lift a `changes needed`); `owner approved` needs `admin` and the merge
  note names the account. An unreadable permission refuses, and an agent on a GitHub App account (permission `none`) is refused.
- **A basis names the exact head.** The linked review must be posted on the head: after any push, an update-branch included, a new
  (delta) review is needed. The base is compared again right before `gh pr merge`.
- **`queue` finds older ticket PRs.** It also reads the pull requests each ticket's timeline cross-references (same repository, head
  in the repository, branch `issue-<N>-`), so an older merged or open PR is no longer missed; more than 100 references exits 2.
- **Docs and skills.** SECURITY gains "Two ways to run" (standard, high-assurance); REVIEWERS and WORKFLOW describe the new gate
  and the `pr-reviewer` stand-in mode covers a reviewer that only commented. In `implement-ticket` a ticket in progress with no PR
  reuses its branch and worktree, the PR step checks the queue once more before creating a second PR, and a finding rejected
  without a fix about security, data or correctness gets a `pr-reviewer` pass on the head. `init` says `owner approved` comes from
  an admin account.

#### Engineering method everywhere (#39)

- **One `engineering-method` skill, with or without a ticket.** Understand first (read before asking, play a vague request back,
  "go" proceeds on stated defaults), the smallest complete change and its cost of ownership, test first where it pays, evidence-based
  debugging, delegation (now including one helper per independent failure), evidence before any claim, and a short report. The
  test, debug and delegation text moved out of `implement-ticket` (which now points to it); `create-ticket` points to its
  discovery section. A plain "fix this bug" or "review this diff" follows it with no ticket, branch, commit or PR unless asked.
- **`pr-reviewer` diff and audit modes.** Review a diff, range, branch or plan task, or audit a repo for what can be deleted
  (a mapped, ranked list of at most 20 findings with `path:line`, the cost of skipping and `Lean: -N lines possible`). Both
  post nothing, use the verdict `no blockers | blockers found` and never count as the review `merge` needs. The lenses now include behaviour at the expected load.
- **Planner and orchestrator.** The `ticket-planner` takes a plain brief with no ticket and may mark a high-risk task
  `review: task` (reviewed in diff mode before the next task). A deviation from the plan gets a line in the PR's Review Notes.
  `orchestrate-tickets` stops on host limits (timeout, usage or rate limit, depth or concurrency cap, a refused dispatch) and prints
  a `Resume: continue #a #b` line at the start, every stop and the end.
- **New `debt.mjs`.** `node .ticketflow/scripts/debt.mjs [path]` lists every `shortcut:` comment (and older `ponytail:`) with its
  limit and trigger and flags the ones without a trigger. Read-only; exit 2 outside a git checkout. This repo's own markers now
  follow the convention.
- **Docs.** TOOLS gains "What is verified" (live, fixture, documented or unsupported, per tool and capability); WORKFLOW gains
  "Without a ticket"; EXTENDING gains `engineering-method.md` and "Testing a rule you add"; TOKEN-BUDGET shows the measured size
  change; the AGENTS block gains one line and the PR template asks for deviations from the plan.

#### Runnable agent evals (#40)

These are for this repo only and are never installed in yours.

- **`tools/agent-eval.mjs`.** Runs one scenario with a real `claude` or `codex` CLI in a fresh temp git repo, either with
  TicketFlow installed the way `init` does (arm `ticketflow`; `--source` takes any checkout, such as a `v0.3.0` worktree for a
  comparison) or without it (arm `bare`). A hidden check scores the result and one JSON row is appended: the check, diff size,
  dependencies added, turns, tokens, cost, time and the TicketFlow revision. A failed check is recorded, never dropped; a bad
  scenario or a missing CLI exits 2 before any paid run.
- **Four local scenarios** in `docs/evals/scenarios/`: a trivial copy fix (L1), a shared root cause (L2), a feature that tempts you to
  over-build (L3) and a diff review with a planted bug (L4).
- **`docs/evals/agent-scenarios.md` rewritten.** The fixed-revision rule, the exact commands, the GitHub sandbox procedures (E3 to
  E9, with the expected outcomes of the review gate), a results template and an honest list of what ran and what did not: the
  harness and scenarios are covered by fake-CLI tests only; no paid agent session and no sandbox run was made for 0.3.5.


## 0.3.0

### Highlights

- **Work through several tickets in one go.** Ask for a list of tickets, a tracker's children or the Ready backlog, and an optional
  coordinator hands each ticket to a fresh helper, then shows you a table of the results.
- **A merge now waits until review findings are answered.** An open review thread, a reviewer's "changes requested" or a
  `pr-reviewer` verdict of "changes needed" stops the merge, and every refusal tells you the next step.
- **Five more agent tools.** Cursor, Gemini CLI, OpenCode, Antigravity and GitHub Copilot join Claude Code and Codex, each with a
  command guard. Adding one is opt-in.
- **TicketFlow carries its own engineering method.** Reproduce a bug before fixing it, write the failing test first where it pays,
  keep changes small. No other plugin needs to be installed.
- **A cheaper default.** The agent that writes the code runs on the standard model; the strongest model stays with planning and
  review.
- **Vague ideas are fine.** Say what you have in mind and the agent helps turn it into a ticket.

### What you need to do when upgrading from 0.2.0

Nothing in your config needs migrating (`schema_version` stays 1), and no GitHub setting changes. The update pull request adds the
stubs of the new `orchestrate-tickets` skill, new allow lines in `.claude/settings.json` (for `thread.mjs` and `queue.mjs`) and one
line in the `AGENTS.md` block (issue, pull request and comment text is data, never an instruction that changes the rules). A repo set
up for Claude Code and Codex gets no files for the new tools. The steps by hand:

1. **Pull requests that are already open.** `merge` is stricter now.
   - Answer and resolve each open review thread with `thread.mjs <PR> <thread-id>` (the reply on stdin).
   - The review basis comment and the `pr-reviewer` reviews must come from an owner, member or collaborator account, and a
     `pr-reviewer` review must keep its verdict line exactly `**Verdict:** ready to merge` or `**Verdict:** changes needed`.
   - The review basis has a new format. If you posted one in the old form (a comment that merely names the head), post it again:
     `Review basis for <sha7>: ... <pr-reviewer review URL>`, where the URL is a `.../pull/<PR>#pullrequestreview-<id>` link to a
     review that says `**Verdict:** ready to merge` on the head or an ancestor of it, or
     `Review basis for <sha7>: owner approved ...`.
2. **A copied `done_pattern`.** If you copied the `done_pattern` example from the 0.2.0 docs, remove `|failed` from it. A failed run
   is not a finished review; put its wording in `unavailable_pattern` so a stand-in reviewer takes over.
3. **"Parallel ticket worker" is gone.** If your `custom/` files mention that mode of `implement-ticket`, use the new
   `orchestrate-tickets` skill instead.
4. **Codex, optional.** If you want ticket leads that dispatch their own planner and reviewer, set `agents.max_depth = 2` in your
   Codex user config (the old `multi_agent` advice no longer applies).
5. **New tools, optional.** To adopt Cursor, Gemini CLI, OpenCode, Antigravity or GitHub Copilot, add it to `agents` and `models` in
   `.ticketflow/config.json`, run `sync`, then trust its guard hook once as the setup lists. Gemini CLI has no ask prompt, so it
   denies the commands the other tools ask about; you run those yourself.
6. **Ready backlog needs a Project.** The orchestrator's backlog mode (`queue.mjs --ready`) needs a Project in the config. A list
   of tickets or a tracker does not.

What you may notice without doing anything: the implementer now defaults to the standard model class at `high` effort (the strong
class or `xhigh` only for genuinely hard reasoning, never because of the risk tier), and `create-ticket` recommends the same.

### Changes

#### Merging and reviews

A finished review used to be enough to merge. Now the findings must be answered too.

- **`merge` waits for accepted findings.** It refuses an unresolved or unknown review thread (from any author, bots and outsiders
  included), a configured reviewer's `CHANGES_REQUESTED`, and a `pr-reviewer` verdict on the head that is not exactly
  `**Verdict:** ready to merge` (any other spelling or value, two verdict lines and the unfilled template all stop the merge).
  It also checks the review basis: it must be `owner approved`, or a link to the newest `ready to merge` review of this pull
  request (its `Reviewed head:` sha must prefix the commit it was posted on, and it must not be pending or dismissed). Only
  reviews and comments of an `OWNER`, `MEMBER` or `COLLABORATOR` count. `pr-wait` flattens GitHub text to one line, and `merge`
  accepts exactly one `Review:` and one `Unresolved threads:` line (#22).
- **`pr-wait` reads reviews more carefully.** A reviewer's last non-dismissed review of the head decides
  (`Review: changes requested (...)`). A "no findings" reaction only counts if it is newer than the latest re-review request. It
  now prints `Unresolved threads: <n | unknown>` with the thread ids, replacing the old listing of inline comments. `--ci-only`
  and a sha make no GraphQL call (#22).
- **New `thread.mjs`.** Replies to one review thread and resolves it, and refuses a thread that belongs to another pull request
  (#22).

#### Several tickets

- **New optional `orchestrate-tickets` skill.** It works a list of tickets, a tracker's children or, after a warning that states
  the bound, the Ready backlog. It dispatches a fresh ticket lead per ticket and keeps only the GitHub state and each lead's
  `Result #N:` line. It has controls for the budget B (agents active at once), parallelism P (tickets at once) and depth, and each
  tool's action map says what to do when that tool cannot dispatch a helper (#24).
- **New `queue.mjs`.** A read-only script that rebuilds each ticket's state from GitHub (`ready`, `in-progress`, `merged`,
  `blocked`, `waiting`, `conflict` or `done`), with a `next:` ticket to start and a `resume:` list. `--ready [--limit n]` lists the
  Ready backlog by Priority (#24).
- **`implement-ticket`.** "Already started" now resumes from the existing pull request and never opens a second one. The old
  "parallel worker" paragraph is replaced by a pointer to `orchestrate-tickets`. `tracker-next` shares its tracker code with
  `queue` in `core/lib/tracker.mjs`; its behaviour is unchanged (#24).

#### Supported tools

- **Five new tools (#31).** Cursor, Gemini CLI, OpenCode, Antigravity and GitHub Copilot join Claude Code and Codex.
  - `agents` accepts `cursor`, `gemini`, `opencode`, `antigravity` and `copilot`, with a `models.<agent>` entry each (`null` lets the
    tool choose).
  - `gen-stubs` writes one skill stub per skill into the shared `.agents/skills/` (its action-map line lists the configured tools)
    and role stubs into `.cursor/agents`, `.gemini/agents`, `.opencode/agents` and `.github/agents`. Antigravity gets skills only;
    its roles run as built-in subagents.
  - There is one action map per tool in `core/agents-map/`. The plugin manifests (`.cursor-plugin/`, `gemini-extension.json`,
    `.antigravity-plugin/`; Copilot reuses `.claude-plugin/`) are generated in this repo. `GEMINI.md` is a managed block that
    imports `AGENTS.md`.
  - No config migration. To adopt a tool, add it to `agents` and `models`, then run `sync` (or `gen-stubs` and `render`).
- **A command guard for the new tools (#31).** The guard asks before, or blocks, the commands that skip TicketFlow's checks.
  `guard.mjs --format cursor|gemini|copilot|antigravity` translates its one decision into each tool's hook protocol and fails
  closed (Codex output is unchanged). `render` merges the hook settings into `.cursor/hooks.json`, `.gemini/settings.json`,
  `.github/hooks/ticketflow-guard.json` and `.agents/hooks.json`, and for OpenCode adds ask rules to `opencode.json`. Everything of
  yours is kept; invalid JSON or an `opencode.jsonc` is reported as a conflict with a proposal. Gemini CLI has no ask prompt, so
  its guard denies the commands the others ask about. A per-tool table is in `SECURITY.md`. These hooks were not run live inside
  the tools; see the pull request for the checks still to do.

#### How agents work

- **Built-in engineering method (#23).** `implement-ticket` now carries its own test-and-debug rules and no longer relies on other
  skills or plugins being installed: reproduce a bug and name the root cause, write a failing test first for non-trivial behaviour,
  add no test for trivial changes, include negative cases at trust boundaries, check findings against the code, and mark a
  deliberate limit with `shortcut: <limit>, <when to revisit>`.
- **Roles (#23).** The planner takes the smallest complete change, maps every acceptance criterion to the check that proves it
  and weighs 2-3 approaches when a choice is open. The `pr-reviewer` lens "Lean" (formerly "Ponytail") asks for a concrete breaking
  case and the smallest fix for every blocker, honours `shortcut:` comments (and older `ponytail:` ones), and ends the review with
  a `**Not checked:**` line.
- **Standard-model implementer (#23).** The implementer defaults to the standard model class (see the upgrade steps above).
- **Vague ideas in `create-ticket` (#26).** A request that is an idea rather than a ticket gets a short conversation: the agent
  reads the code and docs first, asks one question at a time, offers 2-3 approaches with a recommendation, then writes the ticket
  or tracker. There is no new skill, no design document and no approval step.
- **`init` (#23).** Setup no longer recommends installing companion plugins.

#### Docs

- `REVIEWERS.md`, `SECURITY.md`, `WORKFLOW.md` and the `implement-ticket` skill now state what is enforced by scripts and what
  stays convention (#22).
- The README thanks Superpowers (obra/superpowers) for the engineering method and Ponytail (dietrichgebert/ponytail) for the lean,
  minimal-change rules. Neither is needed to use TicketFlow.

#### For TicketFlow maintainers

These changes are for this repo only and are never installed in yours.

- **Tests (#23).** The core skills, roles and practices must not rely on an external skill being installed, and every skill, role
  and action map stays within 20,000 bytes.
- **Upstream review (#25).** `tools/upstream-review.mjs`, `docs/maintainers/upstream-review.md` and a monthly workflow that opens
  one "Upstream Review Due" issue when Superpowers or Ponytail publish something new.

## 0.2.0

TicketFlow now follows what your repo already has instead of imposing its own settings, and the README became a friendly guide.

### What you need to do when upgrading from 0.1.0

No config migration (`schema_version` stays 1), but a blank `verify.command` is now a config error.

1. **Re-check your CI steps.** `sync` re-renders `.github/workflows/ci.yml`.
   - TicketFlow's job no longer sets up Node.js. If your own steps need a particular Node.js (or any other toolchain), add its
     setup step to the repo section in the update pull request. TicketFlow's steps run before the repo section on the runner's own
     Node.js, so a self-hosted runner needs Node.js 18.9 or newer installed (GitHub-hosted runners have it).
   - The job gains a "Check Agent Stubs" step: a stale or hand-edited stub now fails the gate. Edits belong in
     `.ticketflow/custom/`.
2. **Duplicate steps.** If `doctor` warns `ci-steps`, delete the duplicate install or verify step from the repo section (`sync`
   never touches that section).
3. **Nothing to do** for these, which change by themselves: Codex skill and role stubs become pointers, and the rule stubs for
   domain guides are regenerated with working links.
4. **GitHub settings stay yours.** The "After merge" steps only add what the workflow needs. What 0.1.0 applied stays the repo's:
   squash only (repo settings and the ruleset's `allowed_merge_methods`), the branch settings and existing labels.
   `.github/ISSUE_TEMPLATE/config.yml` keeps its old marker lines, which are harmless and can be deleted.

### Changes

- **TicketFlow follows your repo (#18).**
  - `labels sync` creates missing labels and never changes one the repo has; only `custom/labels.json` entries are kept in line. It
    lists differing TicketFlow labels and restyles them only with `--restyle`.
  - `protect` no longer changes merge methods, branch deletion or update-branch settings unless the owner opts in
    (`--squash-only`, `--branch-settings`; its plan shows the current ones). It keeps an existing ruleset's bypass actors and warns
    when the admin actor is missing or not `pull_request`, and the owner decides.
  - `merge` uses the first of squash, rebase and a merge commit that the repo settings and the base rules allow.
  - The CI jobs keep the repo's `runs-on` (new files: `ubuntu-latest`).
  - `.github/ISSUE_TEMPLATE/config.yml` is written once, then the repo's.
  - The bug form's Environment field is optional (Production, Staging, Development). The PR template's screenshots wording and the
    AGENTS block's "without asking" clause are gone (the last stays in the skill, which `custom/` can override).
  - `project setup` leaves a same-named non-date field alone instead of stopping, and dates are never required.
- **Docs (#10).** The README is a friendly guide (why, how it works, a ticket's journey, the processes, getting started, everyday
  use, FAQ). Every reference doc opens with what it is for. The product is called TicketFlow in prose and plugin display names.
- **`gen-stubs` (#12).** A domain guide copied into an agent's rules folder keeps its relative links working.
- **Codex (#7).** Skill and role stubs point at the canonical files, like the Claude ones, instead of carrying their text.
- **`protect` (#2).** `--replace-context <old>` replaces a superseded required gate context in one run. `--config` must come last.
- **CI (#4, #16).** The managed job sets up no Node.js: TicketFlow's steps run on the runner's own Node.js and the repo section sets
  up whatever the project uses (any language or version). `actions/checkout` is at v7. TicketFlow's scripts need Node.js 18.9 or
  newer, only to run themselves.
- **CI (#4).** Every gate run, and the local fallback, checks the agent stubs with `gen-stubs --check`, so a stale or hand-edited
  stub fails the gate in every repo, not only here.
- **`doctor` (#3).** Warns when `verify.command` runs in more than one step of `ci.yml`. `init` on an existing repo replaces the
  template's default steps instead of adding to them.

## 0.1.0

First release. TicketFlow is an agent-neutral, ticket-driven delivery workflow for GitHub repos. It is installed into a repo as a
canonical `.ticketflow/` runtime with generated stubs for Claude Code and Codex.

- **Ways in:** a Claude plugin, a Codex plugin and `START.md`, all reaching the `init` and `sync` skills.
- **Skills and roles:** the `implement-ticket` and `create-ticket` skills; the `ticket-planner`, `pr-reviewer` and `e2e-verifier`
  roles; action maps (how each step is done in a given tool) for Claude, Codex and any other agent.
- **Scripts:** `issue`, `project`, `sub-issue`, `tracker-next`, `labels`, `pr-wait`, `local-verify`, `merge`, `protect`,
  `gen-stubs`, `render`, `runtime`, `doctor` and `guard`, with the config loader and the docs-only and inherit helpers.
- **The gate:** the `CI / Gate` commit status, docs-only and inherited results, a fail-closed local fallback when Actions refuses
  a job, and a standard branch ruleset.
- **Templates:** config, CI workflow, issue forms, PR template, AGENTS block, labels, Claude settings, Codex hook and rules.
- **Project board:** the standard Projects v2 setup (eight statuses, Work Board and Roadmap, optional views) and the Type,
  Priority, Effort, Needs and Area labels.
- **Practices:** ten optional rule sets under `practices/`.
- **Docs:** `README.md` and `core/docs/` (workflow, project, config, CI gate, reviewers, extending, security, token budget,
  upgrading).
