# Published benchmark results

This directory is the repository-facing index for benchmark results. Each real publication is a dated, sanitized Markdown report such as `2026-10-29-agentic.md`; no simulated metrics belong here. There are no published numeric results until a maintainer runs and inspects real sessions.

Generate a local report from a retained session file with:

    node benchmarks/report-local.mjs <recorded-runs.jsonl> --publish --label pilot

Generate a workflow report with the same dated publication convention:

    node benchmarks/report-workflow.mjs <recorded-workflow.jsonl> --publish --label pilot

Publication fails closed unless evaluator and source revisions, model pins, requested effort, CLI versions, repetition cells and evaluation mode are present and comparable. The report includes revisions, models, effort, sandbox mode, methodology, pass rates, costs and limitations, but never copies answers, transcripts, local paths or raw session rows.

Raw JSONL sessions, workflow `.state.json` sidecars, generated CSV files and
`transcripts/` remain ignored by default. Local JSONL rows are the resume ledger;
workflow JSONL rows are paired with the sidecar that preserves remote resource and
in-progress cell state. Each transcript directory contains only `agent.out`,
`answer.txt` and allowlisted `metadata.json`; it is linked from the corresponding
row by `result_row_id` and `transcript_archive`/`transcript_archives`. Keep these
artifacts local, inspect them for plugin bootstrap evidence and sensitive content,
and publish only the sanitized dated Markdown report. See [benchmark methodology](../README.md)
for execution and safety requirements.
