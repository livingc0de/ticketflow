# Workflow benchmark (maintainers only)

An opt-in benchmark on real GitHub repositories. It compares four native approaches (bare agent, Superpowers, Ponytail,
TicketFlow) on the same fixtures. No arm is asked to follow another's process: the prompt is what a person would type,
and each arm decides how to plan, track, review and ship the work. The runner records what each one did and scores the
outcome and the approach by the same rules for every arm.

The point is what a workflow layer adds on top of a capable implementer: many features delivered without a human steering
each step, a durable history and reasoning that other people and agents can read, independent review and fixes, and code
quality. It costs more tokens than implementing directly, so the set includes small tasks where direct implementation is
the right tool and the benchmark shows where the extra process does not pay off.

## Scenarios

| ID | Starting state | Prompt (verbatim style) | Size | Probes |
| --- | --- | --- | --- | --- |
| W1 | Small repo, no tickets | "Could you add a CSV option next to the TSV export?" | one feature | Control: direct implementation is expected to be cheapest |
| W2 | One vague ticket about a money bug | "Can you take a look at issue #1?" | one ticket | Root cause in shared code |
| W3 | Three open tickets with a dependency | "Please work through the open issues." | few | Reading tickets, sequencing, tenant safety |
| W4 | A red pull request with a short review comment | "PR #N is red and has a comment on it, can you sort it out?" | one PR | Continuing existing work, honest verification |
| W5 | One ticket; the first session is stopped once real work exists | "Can you pick up issue #1?", then in a fresh session "Continue where we left off." | one feature | Recovery from whatever the first session left behind |
| W6 | A rough product brief (README with eleven features), no tickets | "Here's roughly what we want for subscriptions, see the README. Can you build it?" | many | Unattended multi-feature delivery, nothing dropped |
| W7 | Seven human-written tickets; after the first session a requirement changes | "Please work through the open issues." then, in a fresh session, "One change: uppercase request IDs are fine too, just normalise them to lowercase." | many | Coordination, overlapping tickets, integrating a change |

The prompts and ticket bodies contain no process wording (tickets, pull requests, review, merging, verification,
reports) and no repository, board or scenario identifiers. Tickets are the starting state only: whether an arm comments on,
links or closes them is its own choice. Fixtures pin the entry points a ticket or brief refers to, so a vague request
does not turn into guessing an API. Each fixture from W2 on carries one or two latent defects in neighbouring code that no
prompt, ticket or brief mentions and that the repository's own tests do not catch.

All arms see identical fixtures, hidden checks and caps. Only the TicketFlow arm installs its Project workflow and moves the
seeded tickets to Ready, because installing the tool is part of adopting it. Seeded items (tickets, the W4 pull request and
its comment) are recorded by ID when the harness creates them and excluded from the measurements by ID; agent activity is
detected by timestamp, never by author or a visible marker.

## How a cell runs

One scenario, one arm, one repeat: a new repository in the disposable organization (or a personal account) and its own
Project, named neutrally (no scenario or arm in the name). Each session is one prompt. If a tool stops and asks whether to
continue, the harness may reply once or twice with the fixed text "go on with whatever is left"; every such reply is counted
as a human intervention. Nothing else is said to the tool. All sessions of a cell share one checkout and one profile, so a
reply continues the conversation that stopped. W5 stops its first session once real product work exists (changes to any file except Markdown and dot-paths) plus a
10 second grace period (short, because current models finish a task like W5 within a minute), then starts a fresh conversation in the same checkout; if the first session finishes before that
point, the interruption is recorded as not reached and the recovery session does not run. W7's second session is a fresh
conversation that carries the changed requirement.

Work may end on the default branch, on a branch or pull request, or only in the local checkout. Correctness is measured on
whatever the arm produced: the default branch, then open pull request heads, ahead branches and the local checkout (including
uncommitted files) as pending work. Where the work landed is recorded as an observation and is not required.

## What is measured

Every measurement is neutral between arms: it asks whether a property holds, never whether a specific artifact exists, and
more artifacts never score higher once the property is delivered. The axes are reported side by side with cost; there is no
blended score.

- **Delivery (A).** Per-requirement hidden checks (landed, pending or missing), regressions on existing behaviour, defect
  checks, and the final state of what landed. Requirements replaced by a later change are excluded.
- **Autonomy (B).** Human interventions (continuation replies), early stops, wall time, and how the work was split or
  parallelised (recorded, not rewarded).
- **Code (C).** Dependencies added, files changed outside the expected scope, lines added and removed, and whether the arm's
  own tests fail on the original code. Maintainability is read by the judge.
- **History and reasoning (D).** A status probe, a fresh model call with no tools that sees only the saved record of the run
  (tickets, pull requests, comments, commit messages, changed documents) and marks each requirement done, partial, not done or unknown, lists what is still open and, for W7, how the late change was
  handled; its answers are scored against the hidden check results.
- **Review and fix (E).** Planted defects fixed or missed, and for a miss whether a review was observed. A defect that landed
  while an independent look was available and absent is recorded as a miss attributable to the missing or ineffective review.
  The judge scores the substance of reviews and fix loops.
- **Process (P).** Observed facts, each judged by its consequence and not by mere presence: whether a durable tracking record
  exists in any form, how the work landed (directly on the default branch with no branch or pull request, branch only, merged pull
  request, local only), whether the landed commit was verified (a green CI job or commit status on an identical tree, or, read from the transcript as a
  heuristic, a passing local test run after the last edit and before the last push), whether a review record exists and when (a
  formal review, a line comment or a substantial pull request comment; the judge decides its substance), and an unsafe-landing flag
  (landed without verification, or landed with a defect a review would have caught). Landing directly on the default branch is not penalised in
  itself, for example on the W1 control.
- **Cost (F).** Tokens, dollars where the CLI reports them, and wall time, with the same figures beside each axis.

The review-would-have-caught-it judgement is an approximation: a defect counts as in scope when the landed diff touches the
file it lives in. The judge and the status probe are model calls, so their results are audited estimates (see Judge).

## Judge

`judge-workflow.mjs` reads the evidence bundle saved for each scored cell (`results/transcripts/evidence-<row>/`: facts, the
code-only diff, a dossier of tickets, pull requests, comments and commit messages, the condensed transcript, the final answers and the
check list) and makes two model calls per run: the probe (dossier only) and the judge (fixed rubric C1-3 code,
D1-3 history, E1-2 review/fix, each 0-3 with quoted evidence). Tool, plugin and skill names are replaced by `[tool]`, and each file keeps its start and its end when it is long. A score whose
quotes do not appear verbatim in what the model saw is discarded, malformed output is recorded as null with a reason (never
imputed), and each cell is judged `--runs` times (default 2) with the disagreement reported. The default judge is the opposite
model family to the arm's agent; a same-family judge is flagged in the output and the report. It is a dry run unless
`--execute` is passed and appends to `<rows>.judge.jsonl`.

The judge follows the runner's isolation rules. Each judge agent gets a disposable profile (a fresh `HOME`, `CLAUDE_CONFIG_DIR` or
`CODEX_HOME`, no personal settings, plugins or hooks, no GitHub credentials) that is removed afterwards. The CLI presence and the login
are checked before the first call, with the same fallback and explicit approval as the runner when a login cannot be used in an
isolated profile (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` for Claude, `codex login` for Codex). Claude runs with no tools. Codex
has no tool-less mode, so it runs with `--sandbox danger-full-access`, like the benchmark arms, in an empty directory, after the same
explicit approval (`--allow-danger-full-access` for a non-interactive run): run it on a disposable machine.

To judge automatically when the cells finish, pass the judge to the runner. The judge runs after any cleanup, on the saved evidence:

    node benchmarks/run-workflow.mjs ... --judge-model YOUR_JUDGE_MODEL [--judge-agent claude|codex]

Without `--judge-agent` the judge is the opposite model family to `--agent`, so the model id must belong to that family.

    node benchmarks/judge-workflow.mjs benchmarks/results/<date>-workflow-claude.jsonl            # plan only
    node benchmarks/judge-workflow.mjs benchmarks/results/<date>-workflow-claude.jsonl --execute --agent codex --model YOUR_CODEX_MODEL

## Setup

Run only on a disposable Linux VM with no personal, cloud or production credentials.
GitHub's [organization creation guide](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/creating-a-new-organization-from-scratch)
is useful background. Organization mode uses a **dedicated GitHub organization**
for benchmark fixtures and two separately scoped credentials. The runner does not
create or delete the organization.

### Organization-mode preparation

Complete these steps once before the first organization-mode run. The runner needs
two separately scoped tokens, but it does **not** require two different GitHub users.
The strongest isolation is two disposable accounts: a setup account that owns the
organization and an agent account that is only a normal organization member. For a
simpler setup, the same account can create both tokens below with different
permissions. In that case, the agent process still receives only the
limited agent token; it does not receive the setup token.

1. **Create the organization.** Sign in to GitHub as the setup account, open
   **Settings → Access → Organizations → New organization**, and create a new
   organization with no production repositories, secrets, teams or integrations.
   A new organization starts with no repositories. Use a plan and enterprise policy
   that permit the public repositories and Actions minutes required by the run.
   Record the lowercase organization login; this is the value passed to `--org`.

2. **Add the agent identity, if using two accounts.** From the organization, open
   **Settings → People → Members → Invite member** and invite the agent account.
   Keep the setup account as an owner, but do not make the agent account an owner.
   Accept the invitation while signed in as the agent account. If both tokens belong
   to the same account, skip this invitation step; the owner already has access.

3. **Set repository access for newly created fixtures.** In **Settings → Access →
   Member privileges**, set **Base permissions** to **Write**. This is deliberate:
   the default is not a reliable push permission for new public repositories, and
   the runner does not add the agent as a collaborator after each repository is
   created. Write is enough for the agent to push branches and create/update issues
   and pull requests; it does not grant repository administration. Because this
   applies to every repository in the organization, keep this organization empty
   except for disposable benchmark material. See GitHub's [base-permission
   documentation](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/setting-base-permissions-for-an-organization).

   Also check **Repository creation** in the same area. An organization owner can
   create repositories regardless of the member setting, so the recommended setup
   identity can create the fixtures. If the setup identity is not an owner, allow
   public repository creation explicitly; otherwise the first `gh repo create`
   will fail.

4. **Enable Projects v2.** In **Settings → Code planning, and automation →
   Projects**, make sure **Enable Projects for the organization** is selected.
   In **Settings → Access → Member privileges**, set **Projects base permissions**
   to **Write** so the agent can edit its own organization-level board. The runner
   creates one new Projects v2 board per cell; you do not need to create boards
   manually. Projects are normally enabled, but verify this because an organization
   or enterprise policy can disable them. See GitHub's [Projects organization
   settings](https://docs.github.com/en/organizations/managing-organization-settings/disabling-project-boards-in-your-organization)
   and [Projects base permissions](https://docs.github.com/en/organizations/managing-organization-settings/managing-base-permissions-for-projects).

5. **Enable Actions.** Open **Settings → Actions → General**, enable Actions for
   all repositories, and allow the public actions used by the fixture, including
   `actions/checkout` and `actions/setup-node`. The benchmark does not need org
   secrets, self-hosted runners, packages, deployments or custom Actions settings.
   Leave workflow `GITHUB_TOKEN` permissions at the repository/organization default;
   the benchmark's setup and agent PATs are separate from that token. Actions are
   enabled by default on new organizations, but check the page because an
   enterprise policy may override it. See [GitHub Actions organization
   settings](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization).

6. **Allow programmatic access.** In **Settings → Personal access tokens**, make
   sure the organization allows fine-grained personal access tokens. If the policy
   requires administrator approval, the setup account must approve the agent token
   before it can access private repositories or Projects. A token created by an
   organization owner normally does not need that approval. See GitHub's [PAT
   organization policy](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization).

No other organization setting is required. The runner creates public repositories,
the neutral Projects v2 boards, issues, the W4 pull-request fixture and the Actions
workflows itself. It does not need wikis, discussions, organization secrets,
webhooks, packages, releases, custom rulesets or a pre-created team.

### Creating the two organization-mode tokens

Create both tokens as **fine-grained personal access tokens** while signed in as the
identity that will own them. Go to **avatar → Settings → Developer settings →
Personal access tokens → Fine-grained tokens → Generate new token**, set a short
expiration, choose the disposable organization as **Resource owner**, and choose
**All repositories**. All repositories is intentional: the runner generates unique
repository names at runtime, so selected-repository access cannot be configured in
advance. The [PAT creation guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
and GitHub's [fine-grained permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
describe the current token UI. The evaluator and TicketFlow's core gate reader use
Actions workflow runs and jobs to classify workflow outcomes. TicketFlow uses the
configured commit status as the authoritative merge gate.

Create a token named, for example, `ticketflow-benchmarks-setup` for the setup role
with these permissions:

- **Repository permissions:** `Administration: Read and write`, `Contents: Read and
  write`, `Issues: Read and write`, `Pull requests: Read and write`, `Commit statuses:
  Read`, `Actions: Read`, `Workflows: Read and write`, and `Metadata: Read`.
  Administration write is needed both to create public repositories and to delete
  exactly those repositories during cleanup. It also covers the runner's read-only
  Actions-policy check. `Actions: Read` lets the evaluator inspect workflow runs and
  jobs. `Workflows: Read and write` is needed to push the seeded
  `.github/workflows/test.yml` file. Do not grant organization administration,
  member, secrets, runners, packages or billing permissions.
- **Organization permissions:** `Projects: Read and write`.

This token creates and seeds repositories, creates and links Projects, creates the
fixture issues/PR, checks Actions, scores CI evidence, and performs cleanup. It is
never passed to the paid agent.

Create a second token named, for example, `ticketflow-benchmarks-agent` for the
agent role. It may belong to the same GitHub account as the setup token; the
distinction is the token's permissions and which environment variable receives it:

- **Repository permissions:** `Contents: Read and write`, `Issues: Read and write`,
  `Pull requests: Read and write`, `Commit statuses: Read and write`, `Actions: Read`, and
  `Metadata: Read`.
  `Commit statuses: Read and write` is required because TicketFlow's local Actions
  fallback posts the authoritative merge-gate status after a runnerless refusal.
  Add `Workflows: Read and write` only if the agent must edit files under
  `.github/workflows`.
- **Organization permissions:** `Projects: Read and write`.

For a separate member account, the organization membership's Write base permission
plus this token lets the agent clone, push branches, create/update issues and pull
requests, and edit the assigned Projects board. With the same account, the token's
fine-grained repository and Projects permissions provide that access directly.
Do **not** grant Administration, organization administration, repository deletion,
member management, secrets, billing or access to any other organization. The agent
token is deliberately unable to create or delete benchmark repositories.

### Supplying and checking the tokens

The generated token value is shown once. Keep it in a password manager or another
secret store; do not commit it, put it in `.env`, paste it into a results file, or
reuse it for production. Export the two variables in the shell that launches the
runner. A hidden prompt avoids putting the values in shell history:

    read -rsp "Setup token: " WORKFLOW_BENCH_SETUP_TOKEN; echo
    export WORKFLOW_BENCH_SETUP_TOKEN
    read -rsp "Agent token: " WORKFLOW_BENCH_AGENT_TOKEN; echo
    export WORKFLOW_BENCH_AGENT_TOKEN

The variable names are exact. The runner injects them as `GH_TOKEN` and
`GITHUB_TOKEN` for the appropriate subprocesses, so you do not need to copy either
value into `gh auth login`. Confirm the identities without printing token values:

    GH_TOKEN="$WORKFLOW_BENCH_SETUP_TOKEN" gh api user --jq .login
    GH_TOKEN="$WORKFLOW_BENCH_SETUP_TOKEN" gh api "orgs/$YOUR_ORG" --jq .login
    GH_TOKEN="$WORKFLOW_BENCH_AGENT_TOKEN" gh api user --jq .login

The setup account must be the organization owner (or otherwise be allowed to create
public repositories), and the second command must print the exact `--org` login.
The setup and agent identity commands may print the same login when using the
same-account/two-token arrangement; that is valid as long as the tokens have the
different permissions documented above.
The runner performs the remaining repository push, Actions and Project access checks
before invoking a paid agent. For TicketFlow cells it also posts a disposable status
with the agent token as a preflight, so missing status-write permission stops before
paid work. For `cleanup-only`, keep both organization variables
available because organization-mode authentication still validates both identities.
After the run or cleanup, remove them from the shell with:

    unset WORKFLOW_BENCH_SETUP_TOKEN WORKFLOW_BENCH_AGENT_TOKEN

GitHub Actions can consume runner minutes independently of model charges. Personal
mode does not require an organization or either workflow token variable.

The runner has two target modes:

- **Organization mode** (`--mode organization`, the default): pass `--org <slug>`
  and use the split setup/agent identities above. This is the recommended mode for
  repeatable benchmark runs.
- **Direct/personal mode** (`--mode personal`): omit `--org`; it uses the existing
  `gh auth login` account for setup, scoring and the agent,
  creates user-owned repositories with a `ticketflow-benchmark-<run-id>-...` prefix,
  and creates user-owned Projects. It does not require the two workflow token
  variables, but it gives the agent the full permissions of that `gh` identity. Run
  personal mode only from a disposable account and pass
  `--acknowledge-personal-account` before paid work. `--org` is accepted only in
  organization mode. There is no `--owner` alias: use `--org` for organization mode
  and omit both flags for personal mode.

Each target mode supports three lifecycles. The default
`run-without-cleanup` preserves remote evidence. Use
`--lifecycle run-with-auto-cleanup` to delete the exact repositories and Projects
recorded in the sidecar after the run, or use
`--lifecycle cleanup-only --out <file> --allow-github-writes` later to resume that
cleanup. Cleanup never deletes an organization or user account, retains the JSONL,
state sidecar and transcript archives, and fails closed on missing or ambiguous
resource records. If a Project identity is missing, cleanup may recover it only
from a recorded pending-creation marker and an exact owner/title/repository
association from a complete, non-paginated owner listing; no match or incomplete
listing is an error and the repository is not deleted. Personal cleanup-only also
requires `--acknowledge-personal-account`.

The runner writes the state sidecar atomically after each resource and cleanup step.
SIGINT and SIGTERM stop the active agent process, record the current cell as
`interrupted`, and leave the sidecar resumable. Auto-cleanup then finishes without
starting another agent. With `run-without-cleanup`, rerun with `--resume` for the
remaining cells or invoke `cleanup-only` after auditing the preserved resources. If
cleanup-only itself is interrupted, it records `cleanup.status: interrupted`; run the
same cleanup-only command again to continue only unfinished deletions. SIGKILL cannot
be caught, so inspect an `agent-running` cell before resuming.

Pin competitor checkouts and the TicketFlow source to reviewed commits. The runner
validates native plugin manifests and source provenance. TicketFlow must have the
canonical origin and either a detached HEAD or an explicit full SHA:

    --ticketflow-source ../ticketflow-reviewed --ticketflow-sha <40-or-64-hex-sha>

Use `--superpowers-sha` and `--ponytail-sha` for attached plugin checkouts. A clean
checkout with a moving branch, dirty files, missing origin or unexpected origin is
rejected before the dry-run plan is printed; detached checkouts may omit the SHA.

### Dry-run and pilot (free until --execute)

    node benchmarks/run-workflow.mjs --agent claude --model YOUR_MODEL \
      --org YOUR_DISPOSABLE_ORG \
      --arms bare,ticketflow,superpowers,ponytail \
      --ticketflow-source ../ticketflow-reviewed --ticketflow-sha <ticketflow-commit> \
      --superpowers-source ../superpowers --ponytail-source ../ponytail \
      --scenarios W1,W2,W3,W4,W5,W6,W7 --repeats 3 \
      --out benchmarks/results/<date>-workflow-claude.jsonl

For the **first real pilot**, use W1, W5 and W6 with all four arms and one repetition, review
the created GitHub resources, the evidence bundles and the transcripts (check `permission_denials` in
each `transcript.json` first), and then expand the matrix. Execute only after inspecting the printed plan:

    node benchmarks/run-workflow.mjs --agent claude --model YOUR_MODEL \
      --org YOUR_DISPOSABLE_ORG --lifecycle run-with-auto-cleanup \
      --arms bare,ticketflow,superpowers,ponytail \
      --ticketflow-source ../ticketflow-reviewed --ticketflow-sha <ticketflow-commit> \
      --superpowers-source ../superpowers --ponytail-source ../ponytail \
      --scenarios W1,W5,W6 --repeats 1 --max-sessions 48 \
      --out benchmarks/results/<date>-workflow-pilot.jsonl \
      --allow-github-writes --execute

Use --agent codex --model YOUR_CODEX_MODEL and explicitly consent to
--allow-danger-full-access for a noninteractive Codex run. This is **not** an
OS security boundary. For unportable keyring logins, the shared auth preflight
requires explicit consent before using the user's profile, potentially loading
personal plugins/settings. A clean isolated profile is strongly preferred.

The complete **7 × 4 × 3 matrix contains 84 planned cells** (all 84 are scored only when their measurements are valid). Each
cell can need several paid invocations: every session plus at most two continuation replies per session, so W1-W4 and W6 allow
up to 3, W5 and W7 up to 6, and the dry run prints the ceiling. `--max-sessions` (default 96) limits possible invocations and
the full matrix needs an explicit larger value. `--budget-usd N` passes a per-invocation dollar cap to Claude; Codex has only
the wall-clock cap (W1-W4 35 minutes, W5 2x25, W6 120, W7 60+30). A cell can also trigger many GitHub Actions runs. An interrupted
invocation reports no cost, so its transcript token usage is priced at list rates as a lower bound (15-30% under the reported cost on
completed sessions); the row sets `cost_complete: false` and the report marks those figures `≥`.

The runner stores per-cell remote repository and Project identities in a private
'.state.json' sidecar next to the JSONL. It records a pending Project-creation
marker before the remote create call, so cleanup can distinguish a recoverable
crash window from an unverified resource. `--resume` keeps that schedule
append-only: you may run scenarios separately, add later scenarios, increase
repeats, or add a new arm with its pinned source. Existing cells, arms and
remote resources are preserved; a later invocation runs only the requested
cells that are still pending. Reordering arguments does not reorder or repeat
existing cells. Removing an arm, changing the owner, source checkout, model,
effort or evaluator code requires a new output/state pair.

For example, these invocations can share one output and sidecar:

    --scenarios W5 --repeats 1
    --resume --scenarios W7 --repeats 1
    --resume --scenarios W5 --repeats 2

The second invocation adds W7; the third adds only W5 repeat 2. A crash during
remote creation may require manual reconciliation: the runner will never
silently reuse an uncertain partially created repository. Keep the JSONL and
sidecar together.

Every agent invocation writes a local transcript archive beneath
`benchmarks/results/transcripts/<session-id>/`: `agent.out`, `answer.txt` and
allowlisted `metadata.json`. The row's `result_row_id` and `transcript_archives`
link the scored cell to those files. Profiles, credentials, environment variables
and temporary workspaces are excluded. Codex external rows use the native
`codex plugin list --json` enabled-plugin result; Claude external rows use the
validated pinned checkout through `--plugin-dir` and record that native loading
path as loaded. The Codex Ponytail arm requires a reviewed, pinned source and a CLI exposing
`codex exec --dangerously-bypass-hook-trust`. The runner passes this switch only
for Ponytail, allowing its bundled lifecycle hooks to execute noninteractively
without changing the user's saved hook trust. This is **hook-code execution without
interactive trust review**; use only a disposable VM and a reviewed source checkout.
The Codex plugin list plus requested bypass is recorded as `loaded`, not verified
hook execution. Missing flag support fails closed before GitHub setup. This proves
plugin availability to the session, not that the model invoked a particular skill
or that hooks actually fired; inspect a live pilot before claiming full activation.

### Reports

    node benchmarks/report-workflow.mjs benchmarks/results/<date>-workflow-claude.jsonl \
      [--judge benchmarks/results/<date>-workflow-claude.jsonl.judge.jsonl] --publish --label pilot

This writes `benchmarks/results/YYYY-MM-DD-workflow-pilot.md`. Use `--out` instead of `--publish` for an explicitly named scratch
preview. The report has one table per axis (delivery, autonomy, code, history, review and fix, process, cost), each per arm
and per scenario and arm, with the median cost beside it. Judge and probe columns appear only with `--judge` and are labelled
audited estimates with the number of runs, the disagreement and the number of null scores. A cell is either **scored** or
**invalid**:

- **Scored:** the evidence was collected and the measurements are trustworthy, whatever the agent achieved. A tool that
  delivered nothing, or delivered it badly, is a scored cell with poor results, never an invalid one.
- **Invalid:** infrastructure prevented a trustworthy measurement, for example GitHub evidence that could not be retrieved
  completely, an unlaunchable check, failed transcript archival or failed benchmark-owned plugin cleanup. Invalid cells are
  excluded from every axis, listed with their reasons, and never converted to agent failures.

Every attempt remains in the append-only JSONL. The report uses the **latest** attempt per cell, shows excluded invalid cells and
the cost they incurred separately, and rejects rows that do not carry the `workflow-v2` schema. `--resume` skips scored cells and
plans only invalid cells for fresh retries, on new repositories and Projects. A previous plugin-cleanup failure blocks paid
retries until the operator inspects the leftovers and passes `--acknowledge-plugin-cleanup` with the usual execute and write
approvals. Pre-agent setup or authentication failures stop without a scored row. Raw transcripts remain local, reports never
copy answers, transcripts or local paths, and three repeats are not statistically conclusive.

## Safety, limits and cleanup

- Real remote resources are created **only** with --execute and --allow-github-writes.
  CI tests and dry-run do not create repositories, Projects or paid sessions.
- The runner creates one public repository and one Project for each cell by
  default to avoid cross-cell contamination. The 84-cell matrix can thus create
  84 repositories and 84 Projects. No production repository is touched.
- Remote resources are **preserved after runs** by default for auditable evidence.
  The auto-cleanup lifecycle deletes only exact repository names and Project IDs
  recorded in the runner's sidecar; cleanup-only can be run after reviewing the
  remote repositories, issues, PRs and Projects. It never deletes an organization,
  account, or local transcript/result artifact.
- If Github Actions/Projects permissions, plugin bootstrap or agent authentication
  fail, do not treat the resulting cell as proof of framework inferiority.
- Native plugin *registration* is not proof that hooks or skills activated. Review the saved transcript archives and run a
  small live pilot on both CLIs before publishing comparisons; the pilot's `permission_denials` show whether plugin skills ran
  under the allowed tools.
- The runner has not been validated by a paid, live four-arm GitHub matrix. Deterministic fixture tests are not a substitute for
  that pilot.
- A single GitHub login can create and review: with one account for setup and agent tokens, a seeded pull request comment shows
  the agent's own login, and no arm can formally approve its own pull request. Both effects apply to every arm equally.
