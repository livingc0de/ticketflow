---
name: create-ticket
description: Use when asked to create, file, split or triage a ticket, record a decision, add a child to a tracker, or when work uncovers a problem too big or unrelated to fix in the running ticket.
---

# Create a ticket

Read `.ticketflow/custom/create-ticket.md` first if it exists: it adds to and overrides this file. Read `.ticketflow/config.json` once. Actions follow the action map your stub names (`.ticketflow/agents-map/generic.md` without one). Descriptions stay short and stable, with no emojis; Markdown goes through a heredoc; nothing ever uses a closing keyword.

**A vague request** (an idea, not yet a ticket): first read the code and docs it touches, and never ask what they already answer. Then ask one question at a time, each saying what the answer changes, until the scope and the acceptance criteria are clear. Where a real choice is open, offer 2-3 approaches and recommend one. Then write the ticket, or a tracker with children (step 2). There is no design document or approval step.

1. **Search first** for a duplicate: `gh search issues --repo <repo> "<words>"` (open and closed by default) (`<repo>` is `repo` in the config). Link related issues instead of repeating them.
2. **One issue is one shippable unit** that one PR can complete. Anything bigger becomes a `Type: Initiative` tracker with children.
3. **Body**, short style, in this order (omit a section only if it is truly empty), Title Case title:
   - Goal (the outcome), Today (verified behaviour with `path:line` and how it was verified, only if you saw it);
   - Scope (In / Out, with `-> #M` for the out-of-scope part);
   - Acceptance criteria (a task list of checkable items; non-trivial logic names its test);
   - Verification (focused checks, live checks), Implementation notes (the laziest correct approach, code to reuse);
   - Execution, Decisions (recorded as decisions, never as open questions; a money rule has its who-pays-whom example), Dependencies (`Depends on` / `Blocks`, real `#N` only).
4. **Execution** is required, and a recommendation the implementer re-checks against the code:
   - Tier: `low | normal | high | critical`, with one line of reason (tiers are defined in the implement-ticket skill).
   - Model and effort: the standard class at high by default; the strong class or xhigh only for genuinely hard work, with the reason.
   - Planning: `planner (the planner runs at claim; the default)`, or `planned earlier: <path to the committed plan> (effort X, verified against <sha>)`, or `skipped, easy and straightforward because: (a) ... (d) ...`, one reason per test of implement-ticket step 2. Effort and complexity decide, not the tier. Unsure: recommend a plan.
5. **Technical plan:** a ticket is planned only when its `Planning:` line links a plan file written by the `ticket-planner` role and committed under `plans_dir` (`YYYY-MM-DD-issue-<N>-<slug>-technical.md`). Model or effort text, a plan-like description or "plan ready" never counts. A plan made before the claim goes into the repo through a docs-only PR in the normal flow. It has at least: files and functions to change, callers checked, fail-closed behaviour, tests, rollout and ops, risks and open decisions, and the line `Verified against <sha> on <date>`. A linked plan is re-verified at claim, never copied.
6. **Labels,** one each of `Type:`, `Priority:` and `Area:` (an Area from `areas` in the config, only when it is not empty), plus `Effort:` for Bug, Feature and Task, plus supporting labels and `Needs: ...` when something blocks readiness. An issue opened through a form carries only its Type: copy the Priority, Effort and Area answers from the body into labels.
7. **Create:** `gh issue create --repo <repo> --title "<Title Case>" --label ... --body-file -` with a quoted heredoc.
8. **Status** (when `project` is set in the config): `node .ticketflow/scripts/project.mjs add <N>`, then `project.mjs status <N> Backlog|Ready|Inbox|Future`: Backlog by default, Ready when the scope is clear and it is unblocked (Ready does not mean planned), Inbox when untriaged, Future for post-launch work. A milestone only for a committed delivery target.
9. **Tracker child:** `node .ticketflow/scripts/sub-issue.mjs add <T> <N> [--after <S>]` places it in the order. An "any time" child goes last and is noted in the tracker's description. Say why on the tracker when a child is added mid-flight.
10. **A bug found during other work** follows the scope rule of implement-ticket: small and related is fixed in the running PR and listed as "Also fixed", with no issue. A big or unrelated one gets an issue (search open issues first; link an existing one instead), with evidence and `path:line`, an honest priority, and a comment `Found #M while working on this.` on the running ticket. It stays out of the PR unless it blocks that ticket's criteria; say so in both.
11. **Decisions:** a question that blocks or materially changes delivery gets a `Type: Decision` + `Needs: Decision` issue: the options, the trade-offs and a **recommended default** implementers can assume. Link it from the blocked issues, which get `Needs: Decision` (or Status Blocked when no default is safe). When it is decided: fill in the Recorded Outcome, comment the rationale, remove `Needs: Decision` here and on the dependents, update the docs, close it.
12. **Hygiene:** close a duplicate with a link: `gh issue close <M> --reason "not planned" --comment "Duplicate of #<N>"`.
13. **Report** the issue link and, in one line, its Execution recommendation.
