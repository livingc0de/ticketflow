# Published benchmark results

This directory is the repository-facing index for benchmark results. Each real publication is a dated, sanitized Markdown report such as `2026-11-10-workflow-pilot.md`; no simulated metrics belong here. There are no published numeric results until a maintainer runs and inspects real sessions.

Generate a report from a retained session file with:

    node benchmarks/report-workflow.mjs <recorded-workflow.jsonl> [--judge <recorded-workflow.jsonl.judge.jsonl>] --publish --label pilot

The report validates the `workflow-v2` row shape, renders invalid attempts and provenance warnings for audit, and keeps the judge and status-probe columns separate from the deterministic axes, labelled as audited estimates. It does not enforce a metadata gate: inspect revisions, plugin evidence, invalid cells and cleanup state before treating a report as a controlled comparison. Reports never copy answers, transcripts, local paths or raw session rows.

Raw JSONL sessions, `.state.json` resume sidecars, judge records, generated CSV files and `transcripts/` (transcript archives and evidence bundles) remain ignored by default. Workflow rows are paired with the sidecar that preserves remote resource and in-progress cell state. Each transcript archive contains only `agent.out`, `answer.txt` and allowlisted `metadata.json`; it is linked from the row by `result_row_id` and `transcript_archive`/`transcript_archives`. Each evidence bundle holds the facts, the code-only diff, a dossier of tickets, pull requests and commit messages, the condensed transcript, the final answers and the check list, and is linked by `evidence_dir`. Keep these artifacts local, inspect them for plugin bootstrap evidence and sensitive content, and publish only the sanitized dated Markdown report. See [benchmark methodology](../README.md) for execution and safety requirements.
