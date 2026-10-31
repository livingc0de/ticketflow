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
Organization mode uses a **dedicated GitHub organization** for benchmark fixtures
and two credentials belonging to identities with clearly limited scope:

- WORKFLOW_BENCH_SETUP_TOKEN: may create private repos, Projects v2, seed Issues/PRs;
  it is never given to the coding agent.
- WORKFLOW_BENCH_AGENT_TOKEN: can work only on benchmark repositories, including
  issue/PR writes, branch push and Project access. **Must not have organization admin**
  permissions or access to production repositories.

The organization must allow Actions, Projects v2 and private repository creation.
The agent identity must already have access to new benchmark repositories. The
harness does not grant or expand permissions. Inspect the two token scopes and
verify repository and Project access before paid runs. GitHub Actions can consume
runner minutes independently of model charges. Personal mode does not require an
organization or either workflow token variable.

The runner has two target modes. Organization mode is the default and uses the
split setup/agent identities above. Personal mode is an explicit convenience mode:
it uses the existing `gh auth login` account for setup, scoring and the agent,
creates user-owned repositories with a `ticketflow-benchmark-<run-id>-...` prefix,
and creates user-owned Projects. It does not require the two workflow token
variables, but it gives the agent the full permissions of that `gh` identity. Run
personal mode only from a disposable account and pass
`--acknowledge-personal-account` before paid work. `--org` is accepted only in
organization mode.

The lifecycle defaults to `run-without-cleanup`, preserving remote evidence. Use
`--lifecycle run-with-auto-cleanup` to delete the exact repositories and Projects
recorded in the sidecar after the run, or use
`--lifecycle cleanup-only --out <file> --allow-github-writes` later to resume that
cleanup. Cleanup never deletes an organization or user account, retains the JSONL,
state sidecar and transcript archives, and fails closed on missing or ambiguous
resource records. If a Project identity is missing, cleanup may recover it only
from a recorded pending-creation marker and an exact owner/title/repository
association; no match is an error and the repository is not deleted. Personal
cleanup-only also requires `--acknowledge-personal-account`.

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
