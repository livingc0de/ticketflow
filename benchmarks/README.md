# Benchmarks (maintainers only)

**Full GitHub pipeline comparisons (W1–W7):** see [WORKFLOW.md](WORKFLOW.md). They use a separate opt-in runner and do not modify the L1–L15 local suite.


This directory is deliberately **outside `core/` and `practices/`**. TicketFlow's installer copies only those two roots; it never installs benchmark scripts, scenarios, data or documentation into a customer's repository. No paid agent runs occur in CI. See [historical eval and GitHub sandbox procedures](SCENARIOS.md) for E3–E9.

## What is measured

- Fifteen small, repeatable scenarios: L1–L4 migrated intact; L5–L11 and L15 cover input boundaries, idempotency, configuration, escaping, pagination, tenant isolation and cent allocation; L12–L14 assess review findings without editing.
- Hidden checkers are outside each disposable task repository. Behavioral checks exercise multiple edge cases and the fixture's own tests; review checks require a located, relevant finding and a clean working tree. These are deliberately limited proxies, **not** complete security or production engineering evaluations.
- For each run: correctness (pass/fail, including failed runs), added/removed lines, touched files, dependencies, elapsed time, tokens, reported cost, model, requested effort and CLI version. Cost per successful task includes all known failed-run cost. Unknown costs stay unknown.
- Optional real-GitHub review and merge-gate tests are documented separately in SCENARIOS.md; they are not equivalent to model performance benchmarks.

## Tool and artifact naming

- `run-local.mjs` runs the L1–L15 local matrix; `agent-eval.mjs` runs one local cell.
- `run-workflow.mjs` runs the W1–W7 GitHub workflow matrix.
- `run.mjs` launches a configured local and/or workflow suite in sequence.
- `report-local.mjs` publishes local results; `report-workflow.mjs` publishes workflow results. Both use dated Markdown names of the form `YYYY-MM-DD-<suite>-<label>.md`.
- `report.mjs` generates both reports, or one selected report, from a configured plan.
- Raw session ledgers are dated `*.jsonl` files chosen with `--out`; they remain ignored. Workflow runs also retain the matching `<file>.state.json` resume sidecar. Transcript archives remain under `benchmarks/results/transcripts/` and are ignored.

## Quick smoke / pilot: no paid work by default

Prepare a clean, pinned older TicketFlow checkout outside this repo:

    git worktree add ../ticketflow-before <older-tag-or-commit>

Inspect the planned sessions (no agents are launched):

    node benchmarks/run-local.mjs --agent claude --model "$CLAUDE_MODEL" --arms before,after --scenarios L1,L2 --repeats 1 --before-source ../ticketflow-before --out benchmarks/results/2026-10-30-local-pilot.jsonl

Run the pilot intentionally (4 paid sessions):

    node benchmarks/run-local.mjs --agent claude --model "$CLAUDE_MODEL" --effort high --arms before,after --scenarios L1,L2 --repeats 1 --before-source ../ticketflow-before --out benchmarks/results/2026-10-30-local-pilot.jsonl --max-sessions 4 --execute

To run one Claude and one Codex matrix in parallel, use separate output files. The cap applies to the combined number of paid sessions, while each agent's sessions remain sequential within its own output:

    node benchmarks/run-local.mjs --parallel --claude-model "$CLAUDE_MODEL" --codex-model "$CODEX_MODEL" --effort high --arms after --scenarios L1 --repeats 1 --claude-out benchmarks/results/2026-10-30-local-claude-pilot.jsonl --codex-out benchmarks/results/2026-10-30-local-codex-pilot.jsonl --max-sessions 2 --allow-danger-full-access --execute

The parallel runner preflights both CLIs and authentication before launching either paid matrix, shares one evaluator fingerprint between the two files, and prefixes their live output. Resume with `--resume` and both output paths; it reruns only missing or fingerprint-mismatched cells.

`--effort` is optional and applies the same level to both agents in parallel mode. Supported levels are `low`, `medium`, `high`, `xhigh` and `max`; Claude receives `--effort LEVEL`, while Codex receives `--config model_reasoning_effort=LEVEL`. If it is omitted, the harness passes no effort setting and each CLI keeps its own model default. The selected value is recorded as `requested_effort` and is part of resume identity and report grouping. For the planned comparison, use model IDs such as `claude-sonnet-5-5` and `gpt-5.6-luna` with `--effort high`.

Run a full before/after comparison by omitting `--scenarios` (all 15 scenarios), selecting `--repeats 3` and setting `--max-sessions 90`. Add `--resume` to continue an interrupted matrix without repeating recorded sessions. Paid resume refuses a changed or missing CLI version; use a fresh output file after upgrading an agent CLI. `--resume` keys include scenario, arm, repetition, model, source commit and the content fingerprint of the evaluator; interrupted sessions with no row must be rerun.

## Five-arm comparison with Ponytail and Superpowers

Both competitors can be evaluated against **native Claude Code plugin checkouts**, not a copied or paraphrased subset of their instructions:

    git clone https://github.com/obra/superpowers.git ../superpowers
    git clone https://github.com/DietrichGebert/ponytail.git ../ponytail
    git -C ../superpowers checkout <pin-a-reviewed-commit>
    git -C ../ponytail checkout <pin-a-reviewed-commit>

After verifying the plugin manifests and that Claude Code supports `--plugin-dir`, inspect this command first **without** `--execute`:

    node benchmarks/run-local.mjs --agent claude --model "$CLAUDE_MODEL" --arms before,after,bare,superpowers,ponytail --before-source ../ticketflow-before --superpowers-source ../superpowers --ponytail-source ../ponytail --repeats 3 --out benchmarks/results/2026-10-30-local-full.jsonl --max-sessions 225

Adding `--execute` runs the planned 225 paid sessions. Claude loads each pinned Superpowers or Ponytail checkout through its native `--plugin-dir` path automatically. Run the two-arm pilot and inspect actual outputs before doing that. Real costs depend on the chosen model and tasks and cannot be predicted here.

For the GitHub workflow runner, every non-bare source must be reproducible. TicketFlow
must come from the canonical `https://github.com/livingc0de/ticketflow` remote and be
either detached or passed with `--ticketflow-sha <full-commit-sha>`; external arms
likewise accept `--superpowers-sha` and `--ponytail-sha` for attached checkouts. Dirty
files, moving branches, missing origins and unexpected origins are rejected before
remote resources or paid sessions start. Selected source revisions are recorded in
the JSONL row and resume identity.

**Codex supports the bare and TicketFlow arms** using the same pinned source checkouts with `--agent codex --model "$CODEX_MODEL"`. Every Codex task is invoked with `--sandbox danger-full-access`. This is intentional for hosts where the CLI's user-namespace sandbox cannot start, but it is not an OS security boundary: run the benchmark on a disposable machine with no personal, production or cloud credentials. The runner prints this notice and requires an explicit approval before Codex paid work; use `--allow-danger-full-access` for a non-interactive invocation. It records `sandbox_mode: danger-full-access` in every Codex row. Codex external arms remain available for dry-run source validation, but are publishable only when the native `codex plugin list --json` result confirms exactly one installed and enabled plugin. Codex's `--ignore-user-config` is omitted only for plugin arms so their isolated plugin configuration loads; the bare and TicketFlow arms retain that flag. In the default isolated mode, each run gets an isolated `HOME` to avoid personal plugins or marketplace files. When available, Codex login state is temporarily copied into the isolated profile and erased after the session; the original `~/.codex` is unchanged. Explicitly approved unisolated runs use the original profile instead and may change its local state.

**Codex authentication preflight:** Before paid sessions, the runner copies `CODEX_HOME/auth.json` (default `~/.codex/auth.json`) into a disposable profile and invokes the CLI's offline `codex login status`. File-based ChatGPT subscription and API-key logins are supported. If the isolated login fails but `codex login status` succeeds on the original profile (for example, via OS keyring), the runner **asks once** whether to continue using that profile without isolation. Replying `yes` automatically continues compatible sessions; declining or having no interactive terminal stops without starting paid work. Raw `OPENAI_API_KEY` environment variables remain stripped. Missing credentials fail without prompting. These checks cannot prove that a token is still valid.

This requires a Codex CLI version with the `codex plugin` subcommands and native Codex plugin manifests in both pinned checkouts. **Installation/enablement is verified; actual skill and hook activation still needs a live trial before publishing comparative conclusions.** Effective models not reported by the CLI remain unknown, rather than being inferred from requested models.

**Claude profiles and authentication:** Each normal session uses a disposable `HOME` and `CLAUDE_CONFIG_DIR`, without personal settings, history or globally installed plugins. A file-based subscription login is copied from `.credentials.json`, or explicitly supplied `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` is forwarded. Other Claude/Anthropic environment overrides are removed in isolated mode. If portable credentials are absent, the runner checks the original `claude auth status`. When that profile is logged in (for example, through macOS Keychain), the runner **asks once** whether to continue without profile isolation, then uses the original login automatically if approved. Refusal, noninteractive input, or a missing login stops before paid work. No Keychain secrets are exported.

**Unisolated fallback is explicit and informed.** When the original Claude or Codex login is available but cannot be transferred to the isolated profile, the runner asks once, before starting any paid work, whether to proceed in the original profile. The warning explicitly says that **existing configuration, personal plugins, skills and hooks can influence benchmark results**, and that the agent may modify its original profile. The matrix runner uses the answer for every pending session automatically. Declining or having no interactive terminal stops safely.

**External plugin arms load automatically.** Claude Superpowers/Ponytail sessions use the validated pinned checkout through Claude's native `--plugin-dir` loading path in the isolated profile, and a successful session records `plugin_bootstrap.status: loaded` with `claude-plugin-dir` evidence. Codex uses a unique, benchmark-owned marketplace name per session, installs the pinned plugin, and treats the native `codex plugin list --json` enabled-plugin result as structured evidence; cleanup removes only that plugin and marketplace registration. A pre-existing Superpowers/Ponytail plugin from another marketplace is never uninstalled, replaced or disabled. If cleanup fails, the paid session row is retained and marked `profile_cleanup: failed`; the benchmark stops and the report refuses publication until the leftover entry is addressed. These are configuration boundaries, not OS security sandboxes.

Recorded results include `profile_isolation: isolated|unisolated` and `sandbox_mode` (`danger-full-access` for Codex, `not-applicable` for Claude). Resuming into a different mode is blocked, and reports clearly distinguish the modes rather than silently pooling them. Scripted/noninteractive fallback fails closed; no manual installation commands are required for an approved run.

**Native plugin loading is recorded from the runner's native setup.** Claude rows are
`loaded` when the pinned checkout passes manifest/provenance validation and the
session is launched with `--plugin-dir`; Codex rows are `verified` from the native
`codex plugin list --json` enabled-plugin result. This proves the plugin was made
available to the session, not that the model invoked a particular skill or hook.
Failed or legacy unknown rows are not publishable. Each session is archived under
`benchmarks/results/transcripts/<session-id>/` with only `agent.out`, `answer.txt`
and allowlisted `metadata.json`; profiles, auth files, environment variables and
temporary workspaces are never copied. Rows link to the archive with
`result_row_id` and `transcript_archive`. Inspect the archive and confirm the recorded
plugin-loading evidence matches the selected arm before publishing. Keep the exact model, model
effort settings, permissions, CLI version, prompt, evaluator SHA and scenarios fixed.
Check that no user-level instruction files or other plugins leak into the bare arm.
Native Superpowers may require interactive design approval; a non-interactive harness
can expose that limitation, not silently bypass it.

## Publish existing rows (free)

    node benchmarks/report-local.mjs benchmarks/results/2026-10-30-local-full.jsonl --publish --label pilot

To generate both suite reports from one plan, use arrays of ordinary reporter arguments:

    {
      "local": ["benchmarks/results/2026-10-30-local-full.jsonl", "--publish", "--label", "pilot"],
      "workflow": ["benchmarks/results/2026-10-30-workflow-full.jsonl", "--publish", "--label", "pilot"]
    }

    node benchmarks/report.mjs --config my-report-plan.json

The publisher writes a dated, sanitized Markdown report under [`benchmarks/results/`](results/), including revisions, models, methodology, per-arm and per-scenario pass rates, descriptive Wilson 95% ranges, timing, change size, costs and limitations. It refuses incomplete or unpinned publications; it never publishes raw session rows, answers, transcripts or local paths. See the [results index](results/README.md). Repeated paired task cells are not independent trials, so these summaries are **not statistical evidence of superiority**. All results must be traceable to actual sessions.

## Safety and operational limits

- The harness runs each task in a temporary Git repository. It is **not a security sandbox**: tools can execute Node/npm scripts, competitor plugins can execute hooks, and an agent may discover evaluator files through the unrestricted Node/npm allowlist. Results are explicitly non-adversarial. Use a disposable VM with no GitHub, cloud, production, or personal credentials.
- No runs are created by `npm test`, by CI, by inspecting the runner, or by running the report. Paid runs require `--execute`, an explicit pinned model, an output file, and a session cap.
- `benchmarks/results/*.jsonl` and `*.csv` are ignored locally to avoid accidentally committing session identifiers and paths. Add sanitized evidence intentionally with `git add -f` when publishing.
- `--source` checkouts should be clean and pinned. A different revision or CLI model invalidates a paired comparison. The workflow runner escalates a timed-out process group from SIGTERM to SIGKILL after a bounded grace period. The harness records unknown descendant-agent token attribution and cannot establish manual-intervention cost from a headless session.
- The original evaluator and all L1–L4 fixtures now live here; the maintainer upstream-change watcher in `skills/upstream/upstream-review.mjs` stays outside this module because it isn't a benchmark.

## Commands

| File | Responsibility |
| --- | --- |
| `agent-eval.mjs` | One real agent run with hidden check and JSON row; paid only when explicitly invoked |
| `run-local.mjs` | Balanced L1–L15 multi-arm, multi-repeat comparison; dry-run by default |
| `run-workflow.mjs` | Paid opt-in W1–W7 GitHub workflow comparison; dry-run by default |
| `run.mjs` | Configured local/workflow suite launcher; dry-run unless `--execute` is passed |
| `report-local.mjs` | Deterministic Markdown/CSV reporting for local rows; no agents |
| `report-workflow.mjs` | Deterministic full-pipeline Markdown reporting for workflow rows; no agents |
| `report.mjs` | Configured local/workflow report launcher |
| `scenarios/` | Task repositories, prompts and private-to-the-agent hidden check manifests |
| `checks/` | Shared deterministic hidden checkers |
| `tests/` | Fake-CLI runner tests, checker calibration and reporting tests |
| `SCENARIOS.md` | Existing benchmark history and GitHub E3–E9 sandbox protocols |
