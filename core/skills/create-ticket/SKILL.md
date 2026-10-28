---
name: create-ticket
description: Use when asked to create, file, split or triage a ticket, record a decision, add a child to a tracker, or when work uncovers a problem too big or unrelated to fix in the running ticket.
---

# Create a ticket

Read `.ticketflow/custom/create-ticket.md` first if it exists: it adds to and overrides this file. Read `.ticketflow/config.json` once. Actions follow the action map your stub names (`.ticketflow/agents-map/generic.md` without one). Descriptions stay short and stable, with no emojis; Markdown goes through a heredoc; nothing ever uses a closing keyword.

**A vague request** (an idea, not yet a ticket): understand it as `.ticketflow/skills/engineering-method/SKILL.md` section 1 says (read the code first, one question at a time, 2-3 approaches when a choice is open), until the scope and the acceptance criteria are clear. Then write the ticket, or a tracker with children (step 2), with every decision in Decisions and the acceptance criteria. There is no design document or approval step.

1. **Search first** for a duplicate: `gh search issues --repo <repo> "<words>"` (open and closed by default) (`<repo>` is `repo` in the config). Link related issues instead of repeating them.
2. **One issue is one shippable unit** that one PR can complete. Anything bigger becomes a `Type: Initiative` tracker with children.
3. **Body**, short style, in this order (omit a section only if it is truly empty), Title Case title:
   - Goal (the outcome), Today (verified behaviour with `path:line` and how it was verified, only if you saw it);
   - Scope (In / Out, with `-> #M` for the out-of-scope part);
   - Acceptance criteria (a task list of checkable items; non-trivial logic names its test);
   - Verification (focused checks, live checks), Implementation notes (the laziest correct approach, code to reuse);
   - Decisions (recorded as decisions, never as open questions; a money rule has its who-pays-whom example), Dependencies (`Depends on` / `Blocks`, real `#N` only).
   - A `low`-tier ticket has only Goal and Acceptance criteria; model, AI effort, tier and planning are labels or claim-time decisions.
4. **Technical plan:** a ticket is planned only when its `Planning:` line links a plan file written by the `ticket-planner` role and committed under `plans_dir` (`YYYY-MM-DD-issue-<N>-<slug>-technical.md`). Model or effort labels, a plan-like description or "plan ready" never counts. A plan made before the claim goes into the repo through a docs-only PR in the normal flow. It has at least: files and functions to change, callers checked, fail-closed behaviour, tests, rollout and ops, risks and open decisions, and the line `Verified against <sha> on <date>`. A linked plan is re-verified at claim, never copied.
5. **Labels,** one each of `Type:`, `Priority:` and `AI Model:`; an `Area:` from `areas` in the config when it is not empty; `Effort:` for Bug, Feature and Task; `AI Effort:` for the model's reasoning effort; plus supporting labels and `Needs: ...` when something blocks readiness. Labels are the source of truth: pass them directly to `gh issue create --label` or add them with `gh issue edit --add-label`, and do not repeat them in the body. Issue forms carry only their static Type/Needs labels; triage adds the remaining labels directly.
   When `environments` is non-empty, choose an `Environment: ...` label directly from that configured list; do not put the same value in the body. Issue forms carry only their static Type/Needs labels; triage adds Environment and the other metadata labels directly.
6. **Create:** `gh issue create --repo <repo> --title "<Title Case>" --label ... --body-file -` with a quoted heredoc.
7. **Status** (when `project` is set in the config): `node .ticketflow/scripts/project.mjs add <N>`, then `project.mjs status <N> Backlog|Ready|Inbox|Future`: Backlog by default, Ready when the scope is clear and it is unblocked (Ready does not mean planned), Inbox when untriaged, Future for post-launch work. A milestone only for a committed delivery target.
8. **Tracker child:** `node .ticketflow/scripts/sub-issue.mjs add <T> <N> [--after <S>]` places it in the order. An "any time" child goes last and is noted in the tracker's description. Say why on the tracker when a child is added mid-flight.
9. **A bug found during other work** follows the scope rule of implement-ticket: small and related is fixed in the running PR and listed as "Also fixed", with no issue. A big or unrelated one gets an issue (search open issues first; link an existing one instead), with evidence and `path:line`, an honest priority, and a comment `Found #M while working on this.` on the running ticket. It stays out of the PR unless it blocks that ticket's criteria; say so in both.
10. **Decisions:** a question that blocks or materially changes delivery gets a `Type: Decision` + `Needs: Decision` issue: the options, the trade-offs and a **recommended default** implementers can assume. Link it from the blocked issues, which get `Needs: Decision` (or Status Blocked when no default is safe). When it is decided: fill in the Recorded Outcome, comment the rationale, remove `Needs: Decision` here and on the dependents, update the docs, close it.
11. **Hygiene:** close a duplicate with a link: `gh issue close <M> --reason "not planned" --comment "Duplicate of #<N>"`.
12. **Report** the issue link and, in one line, its labels and recommended tier/planning route.
