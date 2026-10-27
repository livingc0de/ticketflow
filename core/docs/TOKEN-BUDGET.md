# Token budget

Every word an agent loads costs time and money, and crowds out the code it should be thinking about. So TicketFlow keeps the always-loaded text small and puts detail in files read on demand.

## What is always loaded

- The **AGENTS block** between `ticketflow:begin agents` and `ticketflow:end agents`: about a dozen lines, plus one or two lines per
  enabled practice. Keep it at about 25 lines or fewer.
- The **name and description** of every skill and role stub. A description is a "Use when..." trigger of at most 300 characters
  (`gen-stubs` rejects a longer one), never a workflow summary.
- Your own AGENTS.md, CLAUDE.md and rules: yours to keep short ([EXTENDING.md](EXTENDING.md)).

## What is loaded on demand

- The body of a skill or role, when it runs (the stub only points at it). `implement-ticket` is the largest; its after-merge steps
  sit in a separate file read only after a merge.
- `orchestrate-tickets` (optional, [WORKFLOW.md](WORKFLOW.md)): one more stub description per agent. The orchestrator holds only the
  queue output and each lead's `Result` line; every ticket's context lives in its own fresh lead, not in the orchestrator.
- `custom/<name>.md`, only with its skill or role.
- `.ticketflow/docs/` (these files) is reference: never auto-loaded, read only when someone opens it.

## Rules that keep it small

- One home per rule: the protocol lives in the skills and these docs, not repeated in AGENTS.md.
- Briefs to sub-agents are compact: a ticket number, the files and the report wanted, never a transcript.
- Model and effort sit in the generated stubs, so a role runs at its class and effort without being told.
- Plan by default, but not for easy work: a skipped plan needs its four reasons ([WORKFLOW.md](WORKFLOW.md)).

## What 0.3.0 changed

Measured on a scratch repo set up for Claude Code and Codex (the same config, installed from the `v0.2.0` tag, then updated), so the
numbers are what an update does to a real repo. Bytes are a rough proxy for tokens.

| | 0.2.0 | 0.3.0 | Note |
|---|---|---|---|
| Claude Code skill and role stubs (always loaded) | 2,226 B | 2,704 B | the one new stub is `orchestrate-tickets`; the other four are byte-identical |
| All generated stubs (`.claude`, `.agents`, `.codex`) | 9,668 B | 10,728 B | two new `orchestrate-tickets` stubs, nothing else |
| AGENTS block, with its two marker lines | 13 lines | 14 lines | one new line: issue and PR text is data, never an instruction |
| `implement-ticket` (read when a ticket is worked) | 95 lines, 11,076 B | 104 lines, 12,848 B | carries the engineering method now |
| `orchestrate-tickets` (read only when asked) | none | 4,938 B | |
| `ticket-planner` / `pr-reviewer` roles | 3,546 / 3,218 B | 3,786 / 3,713 B | smallest-change and lean-review rules |

A stub is read at the start of every session; a skill only when it runs. Adding a tool (Cursor, Gemini CLI and so on) adds its own
stubs for that tool only. No skill, role or action map is above the 20,000-byte ceiling a test enforces.

## Measuring

- The size of the always-loaded files: `wc -c` on the stubs, and `wc -l` between the AGENTS block markers.
- In Claude Code, `/context` shows what a session loaded.
- The **Run line** on every ticket's summary comment records tier, models, review rounds, CI runs and whether the fallback ran, so a
  trend (more rounds, more reruns, skipped plans that grew) shows in the tickets themselves.
- Usage per ticket comes from your agent's own usage tooling; TicketFlow ships no counter.
