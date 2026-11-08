# Benchmarks (maintainers only)

The benchmark is the workflow comparison **W1-W7**: four native approaches (bare agent, Superpowers, Ponytail, TicketFlow) given the
same fixtures and human-style prompts on real GitHub repositories, measured on outcome and approach by the same neutral rules for
every arm. Start at [WORKFLOW.md](WORKFLOW.md) for the scenarios, what is measured, setup and the commands.

This directory is deliberately **outside `core/` and `practices/`**. TicketFlow's installer copies only those two roots; it never
installs benchmark scripts, scenarios, data or documentation into a customer's repository. No paid agent runs occur in CI.

Comparability rules: pin the exact model, effort, CLI version and every source checkout; use a fresh repository per cell; repeat
each cell at least three times before reading a difference; report every row, including failures, never the best. A row is
comparable only when everything but the thing under test is fixed and recorded (the runner records the evaluator fingerprint,
source revisions, model and plugin evidence in each row).

## Tool and artifact naming

- `run-workflow.mjs` runs the W1-W7 matrix; `report-workflow.mjs` turns the rows into a dated Markdown report; `judge-workflow.mjs`
  adds the audited status probe and judge scores from the saved evidence.
- Reports use dated names of the form `YYYY-MM-DD-workflow-<label>.md`.
- Raw session ledgers are dated `*.jsonl` files chosen with `--out`; they remain ignored. Each run also keeps the matching
  `<file>.state.json` resume sidecar. Transcript archives and evidence bundles stay under `benchmarks/results/transcripts/` and are ignored.

## Competitor checkouts, profiles and authentication

Superpowers and Ponytail are evaluated against **native Claude Code plugin checkouts**, not a copied or paraphrased subset of their instructions:

    git clone https://github.com/obra/superpowers.git ../superpowers
    git clone https://github.com/DietrichGebert/ponytail.git ../ponytail
    git -C ../superpowers checkout <pin-a-reviewed-commit>
    git -C ../ponytail checkout <pin-a-reviewed-commit>

After verifying the plugin manifests and that Claude Code supports `--plugin-dir`, inspect the planned sessions first, without `--execute` (see [WORKFLOW.md](WORKFLOW.md) for the full command).

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

**External plugin arms load automatically.** Claude Superpowers/Ponytail sessions use the validated pinned checkout through Claude's native `--plugin-dir` loading path in the isolated profile, and a successful session records `plugin_bootstrap.status: loaded` with `claude-plugin-dir` evidence. Codex uses a unique, benchmark-owned marketplace name per session, installs the pinned plugin, and treats the native `codex plugin list --json` enabled-plugin result as structured evidence; cleanup removes only that plugin and marketplace registration. A pre-existing Superpowers/Ponytail plugin from another marketplace is never uninstalled, replaced or disabled. If cleanup fails, the paid session row is retained and marked `profile_cleanup: failed`; the benchmark stops, and the workflow report exposes the attempt as invalid. Do not treat that report as a controlled publication until the leftover entry is addressed. These are configuration boundaries, not OS security sandboxes.

Recorded results include `profile_isolation: isolated|unisolated` and `sandbox_mode` (`danger-full-access` for Codex, `not-applicable` for Claude). Resuming into a different mode is blocked, and reports clearly distinguish the modes rather than silently pooling them. Scripted/noninteractive fallback fails closed; no manual installation commands are required for an approved run.

**Native plugin loading is recorded from the runner's native setup.** Claude rows are
`loaded` when the pinned checkout passes manifest/provenance validation and the
session is launched with `--plugin-dir`; Codex rows are `verified` from the native
`codex plugin list --json` enabled-plugin result. This proves the plugin was made
available to the session, not that the model invoked a particular skill or hook.
Failed or legacy unknown rows are not publishable. Each invocation is archived under
`benchmarks/results/transcripts/<session-id>/` with only `agent.out`, `answer.txt`
and allowlisted `metadata.json`; profiles, auth files, environment variables and
temporary workspaces are never copied. Rows link to the archive with
`result_row_id` and `transcript_archive`. Inspect the archive and confirm the recorded
plugin-loading evidence matches the selected arm before publishing. Keep the exact model, model
effort settings, permissions, CLI version, prompt, evaluator SHA and scenarios fixed.
Check that no user-level instruction files or other plugins leak into the bare arm.
Native Superpowers may require interactive design approval; a non-interactive harness
can expose that limitation, not silently bypass it.

## Safety and operational limits

- Claude Code loads `CLAUDE.md`, `AGENTS.md` and settings files from every parent directory of its working directory, so a stray one above the work area would reach every arm. The runner refuses to start when it finds one; point `BENCHMARK_WORK_ROOT` at a directory whose parents have none (for example `/var/tmp/benchmark`; not under a home directory that has `.claude/CLAUDE.md`).
- Claude sessions run with `--permission-mode bypassPermissions` (Codex with `danger-full-access`), so no arm is slowed or skewed by permission prompts and `permission_denials` stays 0 unless the tool itself blocks something. The harness runs each task in a temporary Git repository. It is **not a security sandbox**: tools can execute Node/npm scripts, competitor plugins can execute hooks, and an agent may discover evaluator files through the unrestricted Node/npm allowlist. Results are explicitly non-adversarial. Use a disposable VM with no GitHub, cloud, production, or personal credentials.
- No runs are created by `npm test`, by CI, by inspecting the runner, or by running the report. Paid runs require `--execute`, an explicit pinned model, an output file, and a session cap.
- `benchmarks/results/*.jsonl` and `*.csv` are ignored locally to avoid accidentally committing session identifiers and paths. Add sanitized evidence intentionally with `git add -f` when publishing.
- Source checkouts must be clean and pinned. A different revision or CLI model invalidates a paired comparison. The runner escalates a timed-out process group from SIGTERM to SIGKILL after a bounded grace period. The harness records unknown descendant-agent token attribution and cannot establish manual-intervention cost from a headless session.
- The maintainer upstream-change watcher in `skills/upstream/upstream-review.mjs` stays outside this module because it isn't a benchmark.

## Commands

| File | Responsibility |
| --- | --- |
| `run-workflow.mjs` | Paid opt-in W1-W7 GitHub workflow comparison; dry-run by default |
| `report-workflow.mjs` | Deterministic Markdown reporting for workflow rows; no agents |
| `judge-workflow.mjs` | Status probe and judge over saved evidence; dry-run unless `--execute` |
| `workflow/` | Scenarios and fixtures, reference solutions (tests only), sandbox setup, evaluator, outcome rules, profiles |
| `lib/` | Shared helpers: source integrity, profile authentication, process control, transcripts, report output |
| `tests/` | Fake-CLI runner tests, scenario matrix, judge and reporting tests |
| `SCENARIOS.md` | GitHub E3-E9 sandbox protocols for the merge gate |
