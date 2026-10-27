# Token budget

Agents pay for every token that is loaded, so ticketflow keeps the always-loaded text small and puts detail in files read on demand.

## What is always loaded

- The **AGENTS block** between `ticketflow:begin agents` and `ticketflow:end agents`: about a dozen lines, plus one or two lines per
  enabled practice. Keep it at about 25 lines or fewer.
- The **name and description** of every skill and role stub. A description is a "Use when..." trigger of at most 300 characters
  (`gen-stubs` rejects a longer one), never a workflow summary.
- Your own AGENTS.md, CLAUDE.md and rules: yours to keep short ([EXTENDING.md](EXTENDING.md)).

## What is loaded on demand

- The body of a skill or role, when it runs (the stub only points at it). `implement-ticket` is the largest; its after-merge steps
  sit in a separate file read only after a merge.
- `custom/<name>.md`, only with its skill or role.
- `.ticketflow/docs/` (these files) is reference: never auto-loaded, read only when someone opens it.

## Rules that keep it small

- One home per rule: the protocol lives in the skills and these docs, not repeated in AGENTS.md.
- Briefs to sub-agents are compact: a ticket number, the files and the report wanted, never a transcript.
- Model and effort sit in the generated stubs, so a role runs at its class and effort without being told.
- Plan by default, but not for easy work: a skipped plan needs its four reasons ([WORKFLOW.md](WORKFLOW.md)).

## Measuring

- The size of the always-loaded files: `wc -c` on the stubs, and `wc -l` between the AGENTS block markers.
- In Claude Code, `/context` shows what a session loaded.
- The **Run line** on every ticket's summary comment records tier, models, review rounds, CI runs and whether the fallback ran, so a
  trend (more rounds, more reruns, skipped plans that grew) shows in the tickets themselves.
- Usage per ticket comes from your agent's own usage tooling; ticketflow ships no counter.
