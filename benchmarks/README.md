# Benchmarks (maintainers only)

This directory is deliberately **outside `core/` and `practices/`**. TicketFlow's installer copies only those two roots; it never installs benchmark scripts, scenarios, data or documentation into a customer's repository. No paid agent runs occur in CI. See [historical eval and GitHub sandbox procedures](SCENARIOS.md) for E3–E9.

## What is measured

- Fifteen small, repeatable scenarios: L1–L4 migrated intact; L5–L11 and L15 cover input boundaries, idempotency, configuration, escaping, pagination, tenant isolation and cent allocation; L12–L14 assess review findings without editing.
- Hidden checkers are outside each disposable task repository. Behavioral checks exercise multiple edge cases and the fixture's own tests; review checks require a located, relevant finding and a clean working tree. These are deliberately limited proxies, **not** complete security or production engineering evaluations.
- For each run: correctness (pass/fail, including failed runs), added/removed lines, touched files, dependencies, elapsed time, tokens, reported cost, model and CLI version. Cost per successful task includes all known failed-run cost. Unknown costs stay unknown.
- Optional real-GitHub review and merge-gate tests are documented separately in SCENARIOS.md; they are not equivalent to model performance benchmarks.

## Quick smoke / pilot: no paid work by default

Prepare a clean, pinned older TicketFlow checkout outside this repo:

    git worktree add ../ticketflow-before <older-tag-or-commit>

Inspect the planned sessions (no agents are launched):

    node benchmarks/run.mjs --agent claude --model "$CLAUDE_MODEL" --arms before,after --scenarios L1,L2 --repeats 1 --before-source ../ticketflow-before --out benchmarks/results/pilot.jsonl

Run the pilot intentionally (4 paid sessions):

    node benchmarks/run.mjs --agent claude --model "$CLAUDE_MODEL" --arms before,after --scenarios L1,L2 --repeats 1 --before-source ../ticketflow-before --out benchmarks/results/pilot.jsonl --max-sessions 4 --execute

Run a full before/after comparison by omitting `--scenarios` (all 15 scenarios), selecting `--repeats 3` and setting `--max-sessions 90`. Add `--resume` to continue an interrupted matrix without repeating recorded sessions. `--resume` keys include scenario, arm, repetition, model and source commit; interrupted sessions with no row must be rerun.

## Five-arm comparison with Ponytail and Superpowers

Both competitors can be evaluated against **native Claude Code plugin checkouts**, not a copied or paraphrased subset of their instructions:

    git clone https://github.com/obra/superpowers.git ../superpowers
    git clone https://github.com/DietrichGebert/ponytail.git ../ponytail
    git -C ../superpowers checkout <pin-a-reviewed-commit>
    git -C ../ponytail checkout <pin-a-reviewed-commit>

After verifying the plugin manifests and that Claude Code supports `--plugin-dir`, inspect this command first **without** `--execute`:

    node benchmarks/run.mjs --agent claude --model "$CLAUDE_MODEL" --arms before,after,bare,superpowers,ponytail --before-source ../ticketflow-before --superpowers-source ../superpowers --ponytail-source ../ponytail --repeats 3 --out benchmarks/results/full.jsonl --max-sessions 225

Adding `--execute` runs the planned 225 paid sessions. Run the two-arm pilot and inspect actual outputs before doing that. Real costs depend on the chosen model and tasks and cannot be predicted here. Codex runs support `before`, `after` and `bare`; competitor plugin installation under Codex's isolated `--ignore-user-config` is intentionally **unsupported** until verified, rather than running an imitation.

**Native plugin activation is not automatically proved by `--plugin-dir`.** Before publishing any competitor result, inspect preserved `agent.out` transcripts and confirm each framework's bootstrap/skills/hooks actually loaded in that Claude CLI version; otherwise mark that arm unverified. Keep the exact model, model effort settings, permissions, CLI version, prompt, evaluator SHA and scenarios fixed. Check that no user-level instruction files or other plugins leak into the bare arm. Native Superpowers may require interactive design approval; a non-interactive harness can expose that limitation, not silently bypass it.

## Report existing rows (free)

    node benchmarks/report.mjs benchmarks/results/full.jsonl --out benchmarks/results/summary.md --csv benchmarks/results/sessions.csv

Reports show per-arm and per-scenario pass rates, Wilson 95% intervals, timing, change size, and cost per successful task where supplied. With only a few repetitions, these are descriptive, **not statistical evidence of superiority**. Publish raw anonymized rows alongside conclusions if you make public performance claims; avoid publishing personal paths, credentials or sensitive agent transcripts. All results must be traceable to actual sessions.

## Safety and operational limits

- The harness runs each task in a temporary Git repository. It is **not a security sandbox**: tools can execute Node/npm scripts, and competitor plugins can execute hooks. Use a disposable VM with no GitHub, cloud, production, or personal credentials.
- No runs are created by `npm test`, by CI, by inspecting the runner, or by running the report. Paid runs require `--execute`, an explicit pinned model, an output file, and a session cap.
- `benchmarks/results/*.jsonl` and `*.csv` are ignored locally to avoid accidentally committing session identifiers and paths. Add sanitized evidence intentionally with `git add -f` when publishing.
- `--source` checkouts should be clean and pinned. A different revision or CLI model invalidates a paired comparison. The harness records unknown descendant-agent token attribution and cannot establish manual-intervention cost from a headless session.
- The original evaluator and all L1–L4 fixtures now live here; the maintainer upstream-change watcher in `tools/upstream-review.mjs` stays outside this module because it isn't a benchmark.

## Commands

| File | Responsibility |
| --- | --- |
| `agent-eval.mjs` | One real agent run with hidden check and JSON row; paid only when explicitly invoked |
| `run.mjs` | Balanced multi-arm, multi-repeat comparison; dry-run by default |
| `report.mjs` | Deterministic Markdown/CSV reporting from recorded rows; no agents |
| `scenarios/` | Task repositories, prompts and private-to-the-agent hidden check manifests |
| `checks/` | Shared deterministic hidden checkers |
| `tests/` | Fake-CLI runner tests, checker calibration and reporting tests |
| `SCENARIOS.md` | Existing benchmark history and GitHub E3–E9 sandbox protocols |
