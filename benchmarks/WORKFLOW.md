# Full-pipeline workflow benchmark (maintainers only)

This is a **separate, opt-in, real GitHub benchmark**, not part of the installed TicketFlow runtime.
It compares four native approaches: bare agent, Superpowers, Ponytail and TicketFlow.
It does **not** ask competitors to follow TicketFlow's workflow.
All arms receive the same product objective, code fixture, available GitHub Project and
scenario-specific starting conditions. The framework decides its own steps.
The runner measures product correctness, review evidence, planning, issue/project evidence, coordination, CI, merge and recovery. It scores code functionality separately from end-to-end pipeline success. Workflow evidence is comparative: no arm is required to use TicketFlow's issue or Project lifecycle.

**Do not merge changes to this directory into the branch running an existing local L1–L15
benchmark.** The local evaluator hashes all files under benchmarks/, so even changes
in this new module change its fingerprint. Finish existing runs on their pinned checkout.

## Scenarios

| ID | Starting state | Task |
| --- | --- | --- |
| W1 | Plain request, no issue | Small CSV feature from request through native planning and delivery |
| W2 | One Ready issue (TicketFlow arm); one ordinary issue (others) | Shared rounding defect, cross-module regression tests and delivery |
| W3 | Three related work items | Agent-led coordination, dependencies, traceability and integration |
| W4 | Existing failing PR and review comment | Repair, reverify current head, respond to review and merge |
| W5 | One issue, deliberate session interruption | Reopen with a fresh session and recover GitHub state without duplicates |
| W6 | Broad request, no issues | Explore, break down, sequence and deliver a complete solution using the setup's native workflow |
| W7 | Four independent existing work items | Coordinate parallelizable work without duplication, integration conflicts or unnecessary overhead |

**GitHub Projects:** Each scenario/arm/repeat gets a new neutral Projects v2 board and
a private repository. The harness creates *only* initial fixtures, not completed work. For W1 and W6 it creates **no issues**. Agents may use issues, plans, pull requests, Projects or another native mechanism to organize and trace the work; the evaluator records those choices rather than requiring a particular one.
All arms can read/write their own board. Only the TicketFlow arm installs/configures
TicketFlow's native Project workflow and moves its seeded issues to Ready.
Other arms are **not** forced to adopt TicketFlow labels, statuses or commands. They may accomplish the same outcomes using their native planning and review processes. TicketFlow does not receive credit simply for extra tickets, skill invocations, or generated artifacts.
For W1 and W6 the Project is empty. TicketFlow may naturally create and manage tracking issues; other arms may use their own planning and coordination mechanisms. Issue creation is evidence of a workflow choice, not a universal acceptance condition.

**Review:** The objective requires a reviewed, verified delivery but does not prescribe a
reviewer or review command. The scoring requires observable review evidence on the final
PR head, not merely an agent's assertion. Functional correctness is reported separately
from pipeline success. Planning usefulness and human interventions require transcript
audit and are not presented as deterministic facts.

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
simpler setup, the same account can create both fine-grained tokens below with
different permissions. In that case, the agent process still receives only the
limited agent token; it does not receive the setup token.

1. **Create the organization.** Sign in to GitHub as the setup account, open
   **Settings → Access → Organizations → New organization**, and create a new
   organization with no production repositories, secrets, teams or integrations.
   A new organization starts with no repositories. Use a plan and enterprise policy
   that permit the private repositories and Actions minutes required by the run.
   Record the lowercase organization login; this is the value passed to `--org`.

2. **Add the agent identity, if using two accounts.** From the organization, open
   **Settings → People → Members → Invite member** and invite the agent account.
   Keep the setup account as an owner, but do not make the agent account an owner.
   Accept the invitation while signed in as the agent account. If both tokens belong
   to the same account, skip this invitation step; the owner already has access.

3. **Set repository access for newly created fixtures.** In **Settings → Access →
   Member privileges**, set **Base permissions** to **Write**. This is deliberate:
   the default is not a reliable push permission for new private repositories, and
   the runner does not add the agent as a collaborator after each repository is
   created. Write is enough for the agent to push branches and create/update issues
   and pull requests; it does not grant repository administration. Because this
   applies to every repository in the organization, keep this organization empty
   except for disposable benchmark material. See GitHub's [base-permission
   documentation](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/setting-base-permissions-for-an-organization).

   Also check **Repository creation** in the same area. An organization owner can
   create repositories regardless of the member setting, so the recommended setup
   identity can create the fixtures. If the setup identity is not an owner, allow
   private repository creation explicitly; otherwise the first `gh repo create`
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

No other organization setting is required. The runner creates private repositories,
the neutral Projects v2 boards, issues, the W4 pull-request fixture and the Actions
workflows itself. It does not need wikis, discussions, organization secrets,
webhooks, packages, releases, custom rulesets or a pre-created team.

### Creating the two organization-mode tokens

Create each token while signed in as the identity that will own it. Go to **avatar →
Settings → Developer settings → Personal access tokens → Fine-grained tokens →
Generate new token**, set a short expiration, choose the disposable organization as
**Resource owner**, and choose **All repositories**. All repositories is intentional:
the runner generates unique repository names at runtime, so selected-repository access
cannot be configured in advance. The [PAT creation guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
and GitHub's [fine-grained permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
describe the current token UI.

Create a token named, for example, `ticketflow-benchmark-setup` for the setup account
with these permissions:

- **Repository permissions:** `Administration: Read and write`, `Contents: Read and
  write`, `Issues: Read and write`, `Pull requests: Read and write`, `Checks: Read`,
  and `Metadata: Read`.
  Administration write is needed both to create the private repositories and to
  delete exactly those repositories during cleanup. It also covers the runner's
  read-only Actions-policy check. Do not grant organization administration, member,
  secrets, runners, packages or billing permissions.
- **Organization permissions:** `Projects: Read and write`.

This token creates and seeds repositories, creates and links Projects, creates the
fixture issues/PR, checks Actions, and performs cleanup. It is never passed to the
paid agent.

Create a second token named, for example, `ticketflow-benchmark-agent` for the
agent role with these permissions. It may belong to the same GitHub account as the
setup token; the distinction is the token's permissions and which environment
variable receives it:

- **Repository permissions:** `Contents: Read and write`, `Issues: Read and write`,
  `Pull requests: Read and write`, `Actions: Read`, `Checks: Read`, and
  `Metadata: Read`.
- **Organization permissions:** `Projects: Read and write`.

For a separate member account, the organization membership's Write base permission
plus this token lets the agent clone, push branches, create/update issues and pull
requests, and edit the assigned Projects board. With the same account, the token's
fine-grained repository and Projects permissions provide that access directly.
Do **not** grant Administration, organization administration, repository deletion,
member management, secrets, billing or access to any other organization. The agent
token is deliberately unable to create or delete benchmark repositories.

If GitHub shows an additional required permission for a specific endpoint, use the
[fine-grained permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
to confirm it. Do not solve a failed request by giving the agent a broad classic
`repo` or `admin:org` token. A classic PAT with `repo` is only a broad fallback for
an account where the fine-grained GraphQL/Projects flow is unavailable; use it only
in the disposable organization, never for the agent if a fine-grained token works,
and revoke it immediately after the run.

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
private repositories), and the second command must print the exact `--org` login.
The setup and agent identity commands may print the same login when using the
same-account/two-token arrangement; that is valid as long as the tokens have the
different permissions documented above.
The runner performs the remaining repository push, Actions and Project access checks
before invoking a paid agent. For `cleanup-only`, keep both organization variables
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

For the **first real pilot**, use just W1 with two arms and one repetition, review
the created GitHub resources and transcripts, and then expand the matrix.
Execute only after inspecting the printed plan:

    node benchmarks/run-workflow.mjs --agent claude --model YOUR_MODEL \
      --org YOUR_DISPOSABLE_ORG --arms bare,ticketflow \
      --ticketflow-source ../ticketflow-reviewed --ticketflow-sha <ticketflow-commit> \
      --scenarios W1 --repeats 1 --max-sessions 2 \
      --out benchmarks/results/<date>-workflow-pilot.jsonl \
      --allow-github-writes --execute

Use --agent codex --model YOUR_CODEX_MODEL and explicitly consent to
--allow-danger-full-access for a noninteractive Codex run. This is **not** an
OS security boundary. For unportable keyring logins, the shared auth preflight
requires explicit consent before using the user's profile, potentially loading
personal plugins/settings. A clean isolated profile is strongly preferred.

The complete **7 × 4 × 3 matrix contains 84 planned cells** (all 84 are scored only when their measurements are valid) but up to **96 paid agent invocations**, because W5 deliberately interrupts and resumes. Explicit
--max-sessions limits possible agent invocations; a cell can also trigger multiple
GitHub Actions runs. Interrupted invocations may not report tokens or USD, so
total cost is unknown rather than estimated.

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
      --publish --label pilot

This writes `benchmarks/results/YYYY-MM-DD-workflow-pilot.md`. Use `--out` instead
of `--publish` for an explicitly named scratch preview. Local reports use the same
convention and are generated by `benchmarks/report-local.mjs` as
`YYYY-MM-DD-local-<label>.md`.

The report uses three mutually exclusive outcomes:

- **Success:** The agent completes the required product and universal reviewed,
  verified delivery gates. Native workflow evidence is reported separately.
- **Failure:** The agent exits unsuccessfully, times out, fails the hidden/product tests,
  or does not complete the required reviewed/verified/merged delivery. Such runs count
  against the arm in its success rate. The deliberate first W5 interruption is not
  a failure if its fresh session successfully resumes.
- **Invalid:** Infrastructure prevents trustworthy measurement, e.g. GitHub evidence
  retrieval/clone failures, evaluator-launch errors, failed transcript archival, or
  failed benchmark-owned plugin cleanup. Invalid results are **excluded** from every
  arm and scenario success-rate denominator, never converted to agent failures.

Every attempt remains in the append-only JSONL. The report scores the **latest**
attempt per cell, displays excluded invalid cells and reasons separately, and
discloses costs incurred by invalid attempts without attributing them to the
framework. A cell with only invalid attempts has a success rate of `n/a`, not
zero. Older records without explicit outcome provenance are flagged as ambiguous.

`--resume` skips valid success/failure cells and plans **only invalid cells for
fresh retries**, on new repositories and Projects. It keeps their earlier remote
resources, rows and archives untouched. A previous plugin-cleanup failure blocks
paid retries until the operator inspects/removes benchmark-owned leftovers and
explicitly passes `--acknowledge-plugin-cleanup` with the usual execute/write
approvals. Pre-agent setup or authentication failures stop without a scored row;
they are not interpreted as competitor failures.
Per-arm comparisons also include review evidence, issue/project tracking coverage,
created issues, plan artifacts, elapsed time and known cost. These are reported as
workflow evidence and are not silently converted into a requirement that every arm
follow the TicketFlow lifecycle. Raw transcripts remain local. Do not
interpret three repeats as statistically conclusive evidence.

The local matrix runner is:

    node benchmarks/run-local.mjs ...

The combined suite wrapper is `benchmarks/run.mjs`. Provide a
JSON file with 'local' and 'workflow' string-arrays of ordinary CLI arguments:

Omitting `--suite` runs both configured suites; pass `--suite local` or
`--suite workflow` to select one.

    node benchmarks/run.mjs --config my-benchmark-plan.json --suite both
    node benchmarks/run.mjs --config my-benchmark-plan.json --suite both --execute

'--execute' must be passed **only** to the wrapper, never embedded in the config.
Each child runner retains its own explicit paid-work and remote-write guards.

The matching report wrapper is `benchmarks/report.mjs`. Its config uses the
same `local` and `workflow` arrays, but each array contains the positional
JSONL input and ordinary reporter options. Publication is therefore explicit
per suite:

    node benchmarks/report.mjs --config my-report-plan.json --suite both

For example, a plan can contain `"local": ["benchmarks/results/2026-10-30-local-full.jsonl", "--publish", "--label", "pilot"]`
and a corresponding `workflow` array. Use `report-local.mjs` or
`report-workflow.mjs` directly when only one ledger needs publishing.

## Safety, limits and cleanup

- Real remote resources are created **only** with --execute and --allow-github-writes.
  CI tests and dry-run do not create repositories, Projects or paid sessions.
- The runner creates one private repository and one Project for each cell by
  default to avoid cross-cell contamination. The 84-cell matrix can thus create
  84 repositories and 84 Projects. No production repository is touched.
- Remote resources are **preserved after runs** by default for auditable evidence.
  The auto-cleanup lifecycle deletes only exact repository names and Project IDs
  recorded in the runner's sidecar; cleanup-only can be run after reviewing the
  remote repositories, issues, PRs and Projects. It never deletes an organization,
  account, or local transcript/result artifact.
- If Github Actions/Projects permissions, plugin bootstrap or agent authentication
  fail, do not treat the resulting cell as proof of framework inferiority.
- Native plugin *registration* is not proof that hooks/skills activated. Review
  saved transcript archives and perform a small live pilot on both CLIs before
  publishing comparisons. W6 records issue-based decomposition, dependency and
  linkage evidence when an arm chooses that workflow; issue creation is optional
  and issue count alone is insufficient.
- The runner has not been validated by a paid, live four-arm GitHub matrix.
  Deterministic fixture tests are not a substitute for that pilot.

## Reporting

Run `node benchmarks/report-workflow.mjs <date>-workflow-claude.jsonl --publish --label pilot` for separate functionality and full-pipeline comparisons by arm and scenario. W1 and W6 leave planning and tracking choices open; issue creation, issue linkage, Project changes and plan artifacts are reported as workflow evidence rather than required steps. W3 and W7 report seeded work-item coverage. Their coordination section records PR-to-work-item coverage and observed dependency closure order without awarding points merely for parallelism or extra PRs. Review evidence and plan counts are proxies, not definitive proof of review quality. Parallel execution is evaluated on correctness, reliability, elapsed time and cost, not rewarded merely for spawning agents.
