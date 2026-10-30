# Published benchmark results

This directory is the repository-facing index for benchmark results. Each real publication is a dated, sanitized Markdown report such as `2026-10-29-agentic.md`; no simulated metrics belong here. There are no published numeric results until a maintainer runs and inspects real sessions.

Generate a report from a retained session file with:

    node benchmarks/report.mjs <recorded-runs.jsonl> --publish --label agentic

Publication fails closed unless evaluator and source revisions, model pins, requested effort, CLI versions, repetition cells and evaluation mode are present and comparable. The report includes revisions, models, effort, sandbox mode, methodology, pass rates, costs and limitations, but never copies answers, transcripts, local paths or raw session rows.

Raw JSONL sessions, generated CSV files and `transcripts/` remain ignored by default.
Each transcript directory contains only `agent.out`, `answer.txt` and allowlisted
`metadata.json`; it is linked from the corresponding row by `result_row_id` and
`transcript_archive`. Keep these artifacts local, inspect them for plugin bootstrap
evidence and sensitive content, and publish only the sanitized Markdown report. See
[benchmark methodology](../README.md) for execution and safety requirements.
