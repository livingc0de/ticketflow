# Full-pipeline workflow benchmark (maintainers only)

This is a **separate, opt-in, real GitHub benchmark**, not part of the installed TicketFlow runtime.
It compares four native approaches: bare agent, Superpowers, Ponytail and TicketFlow.
It does **not** ask competitors to follow TicketFlow's workflow.
All arms receive the same product objective, code fixture, available GitHub Project and
scenario-specific starting conditions. The framework decides its own steps.
The runner measures product correctness, review evidence, planning, ticket creation and lifecycle, coordination, CI, merge and recovery. It scores code functionality separately from end-to-end pipeline success.

**Do not merge changes to this directory into the branch running an existing local L1–L15
benchmark.** The local evaluator hashes all files under benchmarks/, so even changes
in this new module change its fingerprint. Finish existing runs on their pinned checkout.

## Scenarios

| ID | Starting state | Task |
| --- | --- | --- |
| W1 | Plain request, no issue | Small CSV feature from request through delivery |
| W2 | One Ready issue (TicketFlow arm); one ordinary issue (others) | Shared rounding defect, cross-module regression tests and delivery |
| W3 | Three related issues | Agent-led coordination, dependencies, traceability and integration |
| W4 | Existing failing PR and review comment | Repair, reverify current head, respond to review and merge |
| W5 | One issue, deliberate session interruption | Reopen with a fresh session and recover GitHub state without duplicates |
| W6 | Broad request, no issues | Brainstorm, create useful tickets, sequence work, and deliver complete solution |
| W7 | Four independent existing issues | Coordinate parallelizable work without duplication, integration conflicts or unnecessary overhead |

**GitHub Projects:** Each scenario/arm/repeat gets a new neutral Projects v2 board and
a private repository. The harness creates *only* initial fixtures, not completed work. For W1 and W6 it creates **no issues**. New issues and delivery evidence must be produced by the agent itself.
All arms can read/write their own board. Only the TicketFlow arm installs/configures
TicketFlow's native Project workflow and moves its seeded issues to Ready.
Other arms are **not** forced to adopt TicketFlow labels, statuses or commands. They may accomplish the same outcomes using their native planning and review processes. TicketFlow does not receive credit simply for extra tickets, skill invocations, or generated artifacts.
For W1 the Project is empty; agents may choose to create tracking issues.

**Review:** The objective requires a reviewed, verified delivery but does not prescribe a
reviewer or review command. The scoring requires observable review evidence on the final
PR head, not merely an agent's assertion. Functional correctness is reported separately
from pipeline success. Planning usefulness and human interventions require transcript
audit and are not presented as deterministic facts.

## Setup

Run only on a disposable Linux VM with no personal, cloud or production credentials.
Create a **dedicated GitHub organization** used for benchmark fixtures. Use two
credentials belonging to identities with clearly limited scope:

- WORKFLOW_BENCH_SETUP_TOKEN: may create private repos, Projects v2, seed Issues/PRs;
  it is never given to the coding agent.
- WORKFLOW_BENCH_AGENT_TOKEN: can work only on benchmark repositories, including
  issue/PR writes, branch push and Project access. **Must not have organization admin**
  permissions or access to production repositories.

Your GitHub organization must allow Actions, Projects v2 and private repository
creation. The agent identity must already have access to new benchmark repositories.
The harness does not grant or expand permissions. Inspect the two token scopes and
verify repository and Project access before paid runs. GitHub Actions can consume
runner minutes independently of model charges.

Pin competitor checkouts and the TicketFlow source to reviewed commits. The
runner validates native plugin manifests and source provenance.

### Dry-run and pilot (free until --execute)

    node benchmarks/workflow-run.mjs --agent claude --model YOUR_MODEL \
      --owner YOUR_DISPOSABLE_ORG \
      --arms bare,ticketflow,superpowers,ponytail \
      --superpowers-source ../superpowers --ponytail-source ../ponytail \
      --scenarios W1,W2,W3,W4,W5,W6,W7 --repeats 3 \
      --out benchmarks/results/workflow-claude.jsonl

For the **first real pilot**, use just W1 with two arms and one repetition, review
the created GitHub resources and transcripts, and then expand the matrix.
Execute only after inspecting the printed plan:

    node benchmarks/workflow-run.mjs --agent claude --model YOUR_MODEL \
      --owner YOUR_DISPOSABLE_ORG --arms bare,ticketflow \
      --scenarios W1 --repeats 1 --max-sessions 2 \
      --out benchmarks/results/workflow-pilot.jsonl \
      --allow-github-writes --execute

Use --agent codex --model YOUR_CODEX_MODEL and explicitly consent to
--allow-danger-full-access for a noninteractive Codex run. This is **not** an
OS security boundary. For unportable keyring logins, the shared auth preflight
requires explicit consent before using the user's profile, potentially loading
personal plugins/settings. A clean isolated profile is strongly preferred.

The complete **7 × 4 × 3 matrix contains 84 scored cells** but up to **96 paid agent invocations**, because W5 deliberately interrupts and resumes. Explicit
--max-sessions limits possible agent invocations; a cell can also trigger multiple
GitHub Actions runs. Interrupted invocations may not report tokens or USD, so
total cost is unknown rather than estimated.

The runner stores per-cell remote repository and Project identities in a private
'.state.json' sidecar next to the JSONL. --resume refuses changed scenario code,
source checkouts, model, effort, or CLI versions. A crash during remote creation
may require manual reconciliation: the runner will never silently reuse an
uncertain partially created repository. Keep the JSONL and sidecar together.

### Reports

    node benchmarks/workflow-report.mjs benchmarks/results/workflow-claude.jsonl \
      --out benchmarks/results/workflow-summary.md

Functional correctness and full pipeline completion are **separate columns**.
Per-arm comparisons also include review evidence, tracking coverage, created
issues, elapsed time and known cost. Raw transcripts remain local. Do not
interpret three repeats as statistically conclusive evidence.

The old local runner remains:

    node benchmarks/run.mjs ...

There is also a convenience wrapper, without changing either runner. Provide a
JSON file with 'local' and 'workflow' string-arrays of ordinary CLI arguments:

    node benchmarks/run-all.mjs --config my-benchmark-plan.json --suite both
    node benchmarks/run-all.mjs --config my-benchmark-plan.json --suite both --execute

'--execute' must be passed **only** to the wrapper, never embedded in the config.
Each child runner retains its own explicit paid-work and remote-write guards.

## Safety, limits and cleanup

- Real remote resources are created **only** with --execute and --allow-github-writes.
  CI tests and dry-run do not create repositories, Projects or paid sessions.
- The runner creates one private repository and one Project for each cell by
  default to avoid cross-cell contamination. The 60-cell matrix can thus create
  60 repositories and 60 Projects. No production repository is touched.
- Remote resources are **preserved after runs** for auditable evidence. This
  initial implementation does **not** automatically delete GitHub Projects,
  repos, issues, PRs or local transcripts. Only delete resources whose IDs
  match the runner's saved sidecar after reviewing them.
- If Github Actions/Projects permissions, plugin bootstrap or agent authentication
  fail, do not treat the resulting cell as proof of framework inferiority.
- Native plugin *registration* is not proof that hooks/skills activated. Review
  saved transcripts and perform a small live pilot on both CLIs before
  publishing comparisons.
- The runner has not been validated by a paid, live four-arm GitHub matrix.
  Deterministic fixture tests are not a substitute for that pilot.

## Reporting

Run `node benchmarks/workflow-report.mjs benchmarks/results/workflow-claude.jsonl --out benchmarks/results/workflow-summary.md` for separate functionality and full-pipeline comparisons by arm and scenario. W1 checks agent-created tracked work; W6 requires at least two useful agent-created issues linked to delivery; W3 and W7 check that all seeded tickets were completed. Review evidence and plan counts are proxies, not definitive proof of review quality. Parallel execution is evaluated on correctness, reliability, elapsed time and cost, not rewarded merely for spawning agents.
