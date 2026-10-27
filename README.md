# TicketFlow

**A calm, repeatable way for AI coding agents to ship work in your GitHub repo: one ticket at a time, planned, verified,
reviewed and merged safely.**

You describe what you want. Your agent turns it into a ticket, plans it, builds it in its own branch, proves it works, gets it
reviewed, merges it, and tells you what it did. TicketFlow is the rulebook and the tooling that make every one of those steps
the same each time, whether the agent is Claude Code, Codex or anything else that can read files and run a shell.

---

## Why TicketFlow?

AI agents are fast, but left alone they tend to:

- start coding before they understand the change, then patch their own guesses;
- say "done" without proof, or claim a test passed that never ran;
- merge past failing checks, or use an admin override "just this once";
- mark tickets finished that nobody has looked at;
- do things a little differently in every session, and differently again in every repo.

TicketFlow gives them a clear path instead. Each piece of work becomes a ticket, each ticket follows the same lifecycle, and the
important rules are enforced by small scripts and branch protection, not just by asking nicely.

What you get out of it:

- **Predictability.** Every ticket goes through the same steps, so you always know where a piece of work stands and what comes next.
- **Safety.** Branch protection requires a green gate before anything merges, and the merge script also checks that the review is
  done (or attested when a reviewer can't answer). Admin overrides stay yours: agents never use them on their own.
- **Honesty.** A check that could not run is reported as "not verified", never claimed.
- **Your control.** Once every gate passes, the agent merges and hands the work back to you as **In Review**: merged, waiting for
  your look. Only you mark it **Done**, and real decisions (product, data, security, money) are asked, never assumed.
- **Several tickets, optionally.** Ask for a list, a tracker or the Ready backlog and the `orchestrate-tickets` skill hands each ticket to a fresh lead that follows the same workflow, resuming from GitHub after an interruption.
- **One setup for every agent.** Claude Code and Codex read the same skills and rules from one place in your repo.
- **Updates on your terms.** Your repo keeps a pinned copy of TicketFlow and only changes when you run an update.

---

## How it works, in one picture

```
  you ──▶ ticket ──▶ plan ──▶ implement ──▶ verify ──▶ review ──▶ merge ──▶ handoff ──▶ you
          (issue)   (when    (branch +     (CI gate   (independent  (only via   (In Review +
                    needed)   worktree)    on the     reviewer)     the merge   summary)
                                           exact head)              script)
```

Under the hood there are three layers:

1. **The runtime** lives in your repo as `.ticketflow/`: the skills (step-by-step procedures), the reviewer and planner roles,
   small Node.js scripts, templates and these docs. It is a copy of a tagged TicketFlow release.
2. **Agent front doors**: short generated files in `.claude/`, `.agents/` and `.codex/` that point your agents at the runtime, plus a
   short block in your `AGENTS.md`. You never edit these by hand; a generator rebuilds them.
3. **GitHub**: a CI workflow that posts one status called **`CI / Gate`**, a branch ruleset that requires it, a Project board, and a
   standard set of labels.

---

## A ticket's journey

Here is what happens when you say *"implement #42"*:

1. **Read and claim.** The agent reads the ticket, assigns itself, moves it to **In Progress** and posts a short claim comment saying
   how risky it thinks the change is and whether it will plan first.
2. **Plan (by default).** Unless the change is small and obvious, a separate planner role studies the code and writes a technical
   plan. The plan is committed to the repo, so it can be reviewed and reused.
3. **Implement.** The agent works in its own git worktree on a branch like `feat/issue-42-export-csv`, one focused commit per task.
4. **Verify.** CI runs your normal checks and posts `CI / Gate` on the exact commit. If GitHub Actions can't run (a billing hiccup,
   no runner), a careful local fallback runs the same checks and posts the result instead.
5. **Review.** An independent `pr-reviewer` role reviews the pull request against the ticket, security, correctness and your own
   rules: every pull request when it is your only reviewer, the `high` and `critical` ones (or as a stand-in) when you also use an
   external reviewer such as a review bot. Findings are fixed in the same pull request.
6. **Merge.** Only through the `merge` script, which checks the gate, the review and that the branch is up to date, then merges
   exactly that commit.
7. **Hand off.** The ticket moves to **In Review** with a summary: what changed, the evidence, decisions, anything not verified.
   You look it over and mark it **Done** when you're happy.

---

## The processes TicketFlow defines

### Tickets

- **One ticket is one shippable unit** that a single pull request can finish. Bigger work becomes an *Initiative*: a tracker issue
  whose children are sub-issues, worked in order.
- Every ticket has an **Execution** section: a recommended risk tier, model and effort, and whether it should be planned.
- Issue forms for features, bugs, tasks and decisions come pre-made.
- Commits and pull requests say `Ticket #42` or `Refs #42`, never "Closes #42", so merging never closes a ticket behind your back.

### Planning

Planning is the default. A ticket skips it only when all four hold: the change is understood end to end, it is small and in one
place, it touches nothing sensitive (deploys, auth, data, money, concurrency…), and verification is obvious. When in doubt, plan.
A ticket only counts as *planned* when it links a committed plan file. [More in WORKFLOW.md](core/docs/WORKFLOW.md#planning)

### Risk tiers

Every change is `low`, `normal`, `high` or `critical`. The tier decides how deep the review goes and how much effort the agent puts
in, nothing else. Anything touching access, money, migrations, deploys or several subsystems is at least `high`.
[More in WORKFLOW.md](core/docs/WORKFLOW.md#risk-tiers)

### The gate

There is exactly one thing that decides whether a pull request may merge: a green **`CI / Gate`** status on its latest commit.
Changes that touch only the paths you list as docs get it quickly without running the heavy checks. The local fallback is fail-closed: when in doubt it posts nothing.
[More in CI-GATE.md](core/docs/CI-GATE.md)

### Reviews

The `pr-reviewer` role is always available and works with no setup: it reviews every pull request, or only the `high` and `critical`
ones once you add an external reviewer (a bot or a person) in the config. TicketFlow waits for external reviewers and, when you
give it the pattern or timeout to recognise it, notices one that is out of quota or silent and brings in the built-in reviewer as a
stand-in.
[More in REVIEWERS.md](core/docs/REVIEWERS.md)

### Merging and branch protection

Merges happen only through the `merge` script. A standard branch ruleset requires `CI / Gate` and an up-to-date
branch. Your merge methods and branch settings stay yours: the setup shows them and offers squash-only (one commit per ticket) and
tidy-branch settings, which you can take or leave. You, as an admin, can still override it through a pull request when you choose to; agents never do that on their own.
[More in SECURITY.md](core/docs/SECURITY.md)

### The Project board

Optional, but recommended: a GitHub Project with eight statuses: Inbox, Backlog, Ready, In Progress, In Review, Blocked, Done and
Future. The Work Board and Roadmap views are created for you (dates on the Roadmap are never required); a few more views are optional. Labels already in your repo are kept as
they are; TicketFlow only adds the ones that are missing. Labels cover type, priority, effort, area and what a ticket still needs.
[More in PROJECT.md](core/docs/PROJECT.md)

### Live verification

Tests are not the whole story for user-facing changes. A UI, navigation or flow change is also checked in the running product
(by the `e2e-verifier` role, when you point TicketFlow at your live-verify skill). A check that can't run here (a missing key, a real
device) is recorded as not verified, in your deferred-checks issue if you have one, never quietly skipped.

### Decisions

When a ticket hits a real choice (product behaviour, data shape, a security or money trade-off), the agent asks you instead of
guessing, marks the ticket `Needs: Decision`, and carries on with other unblocked work. Small details get a sensible default that is
stated on the ticket. Bigger choices can be recorded as `Type: Decision` issues.

### Branching

Trunk-based: short-lived branches merge into the default branch. Unfinished features hide behind settings flags, not long-lived
branches. [More in WORKFLOW.md](core/docs/WORKFLOW.md#branching)

### Practices (optional)

Ten opt-in rule sets for common needs: live verification in a real browser, runtime settings, i18n, database changes, provider
adapters, API endpoints, UI screens, domain guides, deploy gating and analytics events. Turn on only the ones you want.
[More in EXTENDING.md](core/docs/EXTENDING.md)

---

## What gets installed in your repo

| Where | What | Who edits it |
|---|---|---|
| `.ticketflow/` | the runtime: skills, roles, scripts, templates, docs | only `sync` |
| `.ticketflow/config.json` | your settings: verify command, Project, reviewers, practices… | you |
| `.ticketflow/manifest.json` | what was installed, so updates can tell your changes from TicketFlow's | `init` and `sync` |
| `.ticketflow/custom/` | your additions and overrides to any skill or role | you |
| `.claude/`, `.agents/`, `.codex/` | short generated stubs that point agents at the runtime | the generator |
| `AGENTS.md`, `.claude/CLAUDE.md` | a short managed block; the rest of the file stays yours | the managed block: `sync` |
| `.claude/settings.json`, `.codex/hooks.json`, `.codex/rules/` | the guard: ask/block rules for bypass commands; your own entries stay | TicketFlow's entries: `sync` |
| `.github/workflows/ci.yml` | the gate job in managed blocks; your own CI steps (and your toolchain) in between | the blocks: `sync`; your steps and the `runs-on` runner: you |
| `.github/ISSUE_TEMPLATE/`, PR template | forms and checklist in managed blocks; the issue chooser (`config.yml`) written once | the blocks: `sync`; `config.yml`: you |

Nothing TicketFlow owns is ever hand-edited: you change it in `.ticketflow/custom/` or the config, and the tools regenerate the rest.

---

## Getting started

**You need:** a shell, `git`, the GitHub CLI `gh` 2.48 or newer (logged in with the `repo`, `project` and `workflow` scopes),
Node.js 18.9 or newer (only to run TicketFlow's own scripts: your project can use any language, version or none), and `timeout` (part of coreutils; on macOS `brew install coreutils`). The setup checks all of it for you.

Pick whichever front door suits you. They all lead to the same guided setup:

- **Claude Code:** `/plugin marketplace add livingc0de/ticketflow`, then `/plugin install ticketflow@ticketflow`. Then ask:
  *"set up ticketflow"*.
- **Codex:** `codex plugin marketplace add livingc0de/ticketflow`, then `codex plugin add ticketflow@ticketflow`. Then ask the same.
- **Any other agent:** tell it to read
  [`START.md`](https://raw.githubusercontent.com/livingc0de/ticketflow/main/START.md) and follow it.

The setup interviews you (your verify command, your Project, optional reviewers and practices), writes the files, and opens a
**setup pull request** for you to review. Every GitHub change (labels, Project, branch protection) is shown as a dry run first and
only applied after your yes. Branch protection is switched on after you merge the setup pull request. A brand-new, empty repo gets
one confirmed direct push instead.

Three small things are left for you after the setup merges: in Codex, trust the repo's hook (`/hooks`; again whenever an update
changes it); restart open Claude
Code sessions so they load the new skills; and turn on the Project's built-in workflows that the setup lists (GitHub's API can't).

Already have a CI workflow, a Project or branch protection? The setup adopts them: your own CI steps move into the repo section of
the workflow, an existing Project is topped up, and existing protection is never weakened.

---

## Everyday use

Talk to your agent in plain words:

| You say | What happens |
|---|---|
| "create a ticket for …" | a well-formed issue with labels, an Execution section and its place on the board |
| "implement #42" / "implement the next ticket" | the full journey above, ending In Review with a summary |
| "next child of #10" | the next unfinished sub-issue of an initiative |
| "mark #42 done" | Done and closed, only because you asked |
| "update ticketflow" | the update procedure below |

You stay in charge of three things: answering real decisions (product, data, security or money trade-offs), reviewing the work in
**In Review**, and saying when something is **Done**.

---

## Updating

Ask your agent to *"update ticketflow"* (other agents: follow `skills/sync/SKILL.md` of the TicketFlow repo, as `START.md` says). It fetches the release you choose, shows what changed,
refreshes `.ticketflow/` and the generated files, keeps everything that is yours, and opens an update pull request. Nothing changes
until you merge it. [More in UPGRADING.md](core/docs/UPGRADING.md)

---

## Safety in short

- Agents never use an admin bypass (`--admin`, direct pushes to the default branch, posting a status by hand) unless you explicitly
  ask for that exact action. In Claude Code and Codex, a guard in the repo's agent settings asks before (or blocks) the common forms
  of these commands. It is a seatbelt, not a wall: branch protection is what actually enforces the gate.
- During setup and updates, agents write only inside your repo. They suggest changes to your personal agent settings; they never
  make them.
- A check that could not run is reported, never claimed.

The full threat model and what each safeguard does and doesn't prevent: [SECURITY.md](core/docs/SECURITY.md).

---

## FAQ

**Do I need Claude Code or Codex?** No. They get the smoothest setup, but any agent that can read files and run a shell can follow
`START.md` and the skills. Other agents get no command guard, and without sub-agents the review runs in the same session, so you are
asked before a merge that rests on it.

**Will it slow small changes down?** Small, obvious changes skip planning, pull requests that touch only your listed docs paths skip the heavy checks, and review
depth follows the risk tier. The process grows with the risk, not with the ticket count.

**What if GitHub Actions is down or out of minutes?** The local fallback runs your verify command on the exact commit in a clean
worktree and posts the gate result. It refuses whenever something doesn't add up.

**Can I change the rules?** Yes: put additions in `.ticketflow/custom/<name>.md`, add review guidelines to your `AGENTS.md`, or enable
practices. Never edit the runtime itself; an update would overwrite it.

**What does TicketFlow cost my agent in tokens?** Very little is always loaded: a short AGENTS block and one-line skill descriptions.
Everything else is read only when it is needed. [More in TOKEN-BUDGET.md](core/docs/TOKEN-BUDGET.md)

---

## Documentation

| Doc | Read it when you want to know… |
|---|---|
| [WORKFLOW.md](core/docs/WORKFLOW.md) | the lifecycle in detail: tiers, planning, verifying, reviewing, merging, handoff, branching |
| [PROJECT.md](core/docs/PROJECT.md) | the board: statuses, views, labels and initiative trackers |
| [CI-GATE.md](core/docs/CI-GATE.md) | how the merge gate works, docs-only runs, the local fallback, renaming the gate |
| [REVIEWERS.md](core/docs/REVIEWERS.md) | the built-in reviewer and how to add external ones |
| [CONFIG.md](core/docs/CONFIG.md) | every setting in `.ticketflow/config.json` |
| [EXTENDING.md](core/docs/EXTENDING.md) | how to customize: `custom/`, review guidelines, practices, domain guides |
| [SECURITY.md](core/docs/SECURITY.md) | the threat model and the safeguards |
| [TOKEN-BUDGET.md](core/docs/TOKEN-BUDGET.md) | what agents load and how to keep it small |
| [UPGRADING.md](core/docs/UPGRADING.md) | how updates work and what to watch for |

These docs are also copied into every repo as `.ticketflow/docs/`, so your agent and your team always read the version you run.

Contributing: [AGENTS.md](AGENTS.md). Release notes: [CHANGELOG.md](CHANGELOG.md). License: MIT.
