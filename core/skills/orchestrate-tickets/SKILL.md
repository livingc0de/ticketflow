---
name: orchestrate-tickets
description: Use when asked to work through several tickets in one run (a list, a tracker's children or the ready backlog), or to continue or resume such a run.
---

# Orchestrate several tickets

- Read `.ticketflow/custom/orchestrate-tickets.md` first if it exists: it adds to and overrides this file. Actions are done as the action map your stub names says; without one, use `.ticketflow/agents-map/generic.md`.
- Optional. One ticket is `implement-ticket`, unchanged. You are the coordinator: each ticket is delivered by a fresh ticket lead that follows `implement-ticket`.
- You never edit files, run git, read diffs, code or logs, review, merge or set a status. You hold only the queue output and each lead's result. The answer to "what is done" is GitHub, never your memory or a lead's report.

## 1. Scope and limits

- **Scope:** the tickets the user listed, or a tracker's children. With neither, the scope is the ready backlog: before the first dispatch, show the user a warning that you will work the Ready backlog, the bound (at most the 10 highest-priority ready tickets, in Priority then number order) and the ticket list, then proceed without waiting for an answer. From then on the scope is exactly those ticket numbers: every loop and every resume runs the queue with them, never the ready backlog again (tickets leave Ready once claimed, so the list would drift). To resume a backlog run, restate the numbers, or the user asks for the ready backlog afresh. No project configured: ask for a list.
- **Budget B** = agents active at once, including you; default 3, or the user's number. **Parallelism P** = tickets at once; default 1, at most floor((B-1)/2), because each lead keeps one slot for its own specialist. Depth: you, then leads, then specialists; nothing deeper. Specialists never dispatch.
- Announce B, P, the stop conditions and the resume line (step 6) once. Raise P only on request, judging from the tickets' scope and plans (you read no code; a fresh helper may look) that they are independent: disjoint files, migrations, config, generated files, CI, deploy and lockfiles, and no order or dependency between them.
- Dispatch is the action map's "Dispatch a fresh ticket lead". A refused dispatch or a missing nesting follows the map's Nesting and Limits rules. Never pretend a dispatch happened. No fresh lead at all: deliver one ticket yourself with `implement-ticket`, then stop and say so.

## 2. Loop

1. Run `node .ticketflow/scripts/queue.mjs` with the list, `--tracker <T>` or `--ready`. Exit 2 or no output: stop and report; never guess a next ticket.
2. States: `merged`, finish the handoff (a lead continues from step 7 of `implement-ticket`); `in-progress`, only on a resume, a lead continues from its PR; `conflict`, stop and report both PRs; `blocked` and `waiting`, skip and list them; `ready`, start the line's `next:` ticket.
3. Dispatch one fresh ticket lead of the standard class at high effort with the brief below. Never a copy of this conversation. **Batch:** up to 3 `ready` tickets that are each labelled `Effort: XS` with no `Security` or `Needs:` label (read the labels with `node .ticketflow/scripts/issue.mjs <N>`) may share one fresh lead, in the queue's order and with the batch brief below; a batch uses one lead slot. Anything else, and every `in-progress` or `merged` ticket, gets its own fresh lead: that stays the default.
4. When it returns, run the queue again. GitHub wins over the report; a disagreement is reported, never trusted. A ticket whose queue line is the same as before its lead was dispatched is not dispatched again in this run: handle it as in step 5. Without a project a merged ticket shows `done`: its handoff cannot be seen.
5. `Result #N: needs-review` (the lead could not dispatch a reviewer and the change needs one: its lane is `review`, or it is `high` or `critical`): dispatch the `pr-reviewer` role yourself for that PR, then a fresh lead "continue #N". A `failed` or `blocked` result, or a second failed lead: skip the ticket for the rest of the run, write nothing to GitHub, list it as blocked in the report, then take the next `ready` row (a list or the backlog) or stop (a tracker).
6. Stop at: nothing ready, a `conflict`, the user's stop, `needs-decision` on a tracker (a list continues), or a host limit: session timeout, usage or rate limit, a depth or concurrency cap, a refused dispatch that cannot be worked around. Interrupted run: start at step 1, state is rebuilt from GitHub. The announcement, every stop and the final report end with `Resume: continue #a #b` (the tickets not merged yet, or `continue the children of #T`). One coordinator per scope: a second one on the same tickets duplicates work.

## 3. Lead brief, verbatim with the number filled in

> Ticket lead for #N. Follow `.ticketflow/skills/implement-ticket/SKILL.md` end to end; for an already started ticket, continue from its PR. You cannot ask the user: where it says ask, stop and report. For a material decision, set Needs: Decision with a recommended default (create-ticket step 11). Use the tier's process (`.ticketflow/docs/WORKFLOW.md` Risk tiers): a self-check where merge accepts it, the strong planner only on a trigger. Dispatch at most one specialist at a time; specialists never dispatch. If you cannot dispatch a role, plan inline, and once CI is green report needs-review instead of reviewing inline when the change needs a review. Fix related small findings in this PR; never commit secrets. First line: `Result #N: merged <PR> <sha7> | needs-review <PR> <sha7> | needs-decision #D | blocked <reason> | failed <reason>`, then at most 10 lines: PR, gate, review verdict, not verified, follow-ups, Run line.

Batch variant, for tickets #A #B #C in this order:

> Ticket lead for #A, #B, #C. Deliver them one after another, each exactly as the brief above says for one ticket: its own branch, PR, review and handoff, never a shared branch or PR. Finish a ticket (merged, or handed back with its result) before you read the next one, and read each ticket afresh from GitHub. A ticket that fails, blocks or needs a decision does not stop the others. First lines: one `Result #N: ...` line per ticket in the format above, then at most 10 lines per ticket: PR, gate, review verdict, not verified, follow-ups, Run line.

## 4. Final report

A table: merged, In Review, blocked, needs decision, not started, no-op. Per ticket: PR, merge sha, review, not verified, follow-ups. Totals from the leads' Run lines. Never "Done": that is the owner's.
