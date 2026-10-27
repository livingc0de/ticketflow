# Project

The Project board is where you see all work at a glance: what is waiting, what an agent is doing right now, and what is ready for
you to look at. TicketFlow keeps it tidy for you: agents move tickets as they work, and the labels say what kind of work each
ticket is, how urgent it is and how big.

TicketFlow tracks work in one GitHub Project (Projects v2, never classic) linked to the repo, set in the `project` config key
(keys: [CONFIG.md](CONFIG.md)). Without it, the skills skip the status steps and `project.mjs` exits with an error.
Everything below is done through the API: `project.mjs`, `sub-issue.mjs`, `tracker-next.mjs`, `queue.mjs`, `labels.mjs`.

## Statuses

| Status | Meaning |
|---|---|
| Inbox | Not triaged. |
| Backlog | Accepted, not ready to start. |
| Ready | Scope is clear and nothing blocks it. Ready does not mean planned. |
| In Progress | Claimed and being worked on; set at the claim. |
| In Review | Merged, awaiting the owner's review. The issue stays open. This is the default handoff. |
| Blocked | Waiting on a named blocker; only with a comment naming the blocker and the next action. |
| Done | Accepted by the owner. |
| Future | Deliberately deferred; not a completion state. |

**Done only on request.** An agent never sets Done or closes an issue on its own: when the owner asks, `project.mjs status <N> Done`,
then `gh issue close <N>`. Pull requests say `Ticket #N`, never a closing keyword, so no workflow closes or moves an issue on merge.

Two date fields exist too, for the Roadmap: Start Date and Target Date. They are never required: no form, step or check asks for a
date, and a same-named field the repo already has (of another type) is left alone.

## Views

Standard, always, in this order: **Work Board** (a board grouped by Status), then **Roadmap** (`is:open`).
Optional, picked in `project.views` of the config: **All Work** (a table of everything), **Initiatives** (`label:"Type: Initiative"`),
**Open Decisions** (open `Type: Decision`), **P0/P1 Open** (open P0 and P1, without initiatives). The label views use only the
standard labels.

## Setup

`project.mjs setup [--dry-run]` creates the project when `project.number` is `0` (finding or creating the one titled `project.title`)
or tops an existing one up to the standard, then reads everything back. It never loses data: Status options keep their ids, extra
options are dropped only while the project has no items, existing views are only reported, and the unwanted "Item added to project"
workflow is removed only while the project is empty. It sets the repo link, the eight statuses, the date fields, the views, and a
short README when missing. Put a created project's number in the config (setup does not edit it).

The API cannot turn workflows on. The standard expects these built-in workflows enabled; setup reports any that are not, to turn on in
the project's Workflows page: Auto-add sub-issues to project, Auto-close issue, Item closed, Pull request linked to issue, Pull
request merged.

## Labels

Type, Priority, Effort and Area are labels, not project fields, so nothing is stored twice. `core/templates/labels.json` is the list.

- `Type:` Bug, Feature, Task, Decision, Initiative.
- `Priority:` P0 Critical, P1 High, P2 Medium, P3 Low.
- `Effort:` XS, S, M, L, XL (Bug, Feature and Task only; XL means split it).
- `Needs:` Decision, Design, Legal, External, Reproduction: something blocks readiness.
- Supporting: UX, Content, Security, Testing, Documentation, Technical Debt.
- `Area: <name>` for each name in `areas` of the config.
- Your own, in `.ticketflow/custom/labels.json` (same format).

`labels.mjs sync <file> [--restyle] [--prune] [--dry-run]` creates the missing labels. A label the repo already has is the repo's: its colour,
description and case are never changed, except for the entries of `custom/labels.json`, which are kept in line, and, on the owner's
choice, `--restyle` (a dry run lists each differing label as `differs:`). It deletes other labels
only with `--prune`, and only those no issue or pull request uses. The issue forms (feature, bug, task, decision) carry the Type label;
the creator copies the Priority, Effort and Area answers from the body into labels.

## Trackers

A `Type: Initiative` issue is a tracker; its children are GitHub sub-issues, in order.

- `sub-issue.mjs add <tracker> <issue> [--after <issue>]` makes an issue a child, never replacing an existing parent.
- `tracker-next.mjs <tracker>` prints the first child, in the tracker's order, that is not done. Done means closed, or In Review or
  Done in the configured project. "Any time" children (list items under a heading or bold line starting with "Any time" in the tracker
  body) are never `next` and are listed separately.
- `queue.mjs (<N>... | --tracker <T> | --ready [--limit n])` is read-only: it prints each ticket's state (`ready`, `in-progress`, `merged`,
  `blocked`, `waiting`, `conflict`, `done`) rebuilt from the issue, its Status, labels, `Depends on #N` lines and the pull requests on its
  `*/issue-<N>-*` branches, then `next:` and `resume:`. `--ready` lists the Ready tickets by Priority label, then number. Only pull requests from this repository count; a tracker child of another repository is an error. Without a project, a merged pull request shows as `done`: the handoff cannot be seen. Follow-up work after a merge needs its own ticket (the merged PR keeps the old one `merged`), and a `Depends on owner/other#N` ref keeps the ticket `waiting` until the owner edits it out.
- Say why on the tracker when a child is added mid-flight.
