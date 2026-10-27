# TicketFlow

**A calm, repeatable way for AI coding agents to ship work in your GitHub repo: one ticket at a time, planned, verified,
reviewed and merged safely.**

You describe what you want. Your agent turns it into a ticket, plans it, builds it in its own branch, proves it works, gets it
reviewed, merges it, and tells you what it did. TicketFlow is the rulebook and the tooling that make every one of those steps
the same each time, whether the agent is Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity, GitHub Copilot or anything else that can read files and run a shell.

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
- **Safety.** Branch protection requires a green gate before anything merges, and the merge script also checks that the review
  findings were answered. Admin overrides stay yours: agents never use them on their own.
- **Honesty.** A check that could not run is reported as "not verified", never claimed.
- **Your control.** Once every gate passes, the agent merges and hands the work back to you as **In Review**: merged, waiting for
  your look. Only you mark it **Done**, and real decisions (product, data, security, money) are asked, never assumed.
- **Several tickets, optionally.** Ask for a list, a tracker or the Ready backlog and the `orchestrate-tickets` skill hands each ticket to a fresh lead that follows the same workflow, resuming from GitHub after an interruption.
- **One setup for every agent.** Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity and GitHub Copilot read the same skills and rules from one place in your repo; any other agent follows `AGENTS.md`.
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
2. **Agent front doors**: short generated files in the folders of the agents you use (`.claude/`, `.agents/`, `.codex/`, `.cursor/`,
   `.gemini/`, `.opencode/`, `.github/agents/`) that point your agents at the runtime, plus a short block in your `AGENTS.md`. You never edit these by hand; a generator rebuilds them.
3. **GitHub**: a CI workflow that posts one status called **`CI / Gate`**, a branch ruleset that requires it, a Project board, and a
   standard set of labels.

---

## A ticket's journey

Here is what happens when you say *"implement #42"*:

1. **Read and claim.** The agent reads the ticket, assigns itself, moves it to **In Progress** and posts a short claim comment saying
   how risky it thinks the change is and whether it will plan first.
2. **Plan (by default).** Unless the change is small and obvious, a separate planner role studies the code and writes a technical
   plan. The plan is committed to the repo, so it can be reviewed and reused.
3. **Implement.** The agent works in its own git worktree on a branch like `feat/issue-42-export-csv`, one focused commit per task,
   following TicketFlow's built-in [engineering method](#building-the-engineering-method).
4. **Verify.** CI runs your normal checks and posts `CI / Gate` on the exact commit. If GitHub Actions can't run (a billing hiccup,
   no runner), a careful local fallback runs the same checks and posts the result instead.
5. **Review.** An independent `pr-reviewer` role reviews the pull request against the ticket, security, correctness and your own
   rules: every pull request when it is your only reviewer, the `high` and `critical` ones (or as a stand-in) when you also use an
   external reviewer such as a review bot. Findings are fixed in the same pull request.
6. **Merge.** Only through the `merge` script. It checks the gate, that the branch is up to date and that the review was
   answered (no open review thread, no "changes requested", no "changes needed" verdict), then merges exactly that commit.
7. **Hand off.** The ticket moves to **In Review** with a summary: what changed, the evidence, decisions, anything not verified.
   You look it over and mark it **Done** when you're happy.

---

## The processes TicketFlow defines

### Tickets

- **One ticket is one shippable unit** that a single pull request can finish. Bigger work becomes an *Initiative*: a tracker issue
  whose children are sub-issues, worked in order.
- Every ticket has an **Execution** section: a recommended risk tier, model and effort, and whether it should be planned.
- **Vague ideas are fine.** Say *"I have an idea for ..."* and the agent reads the code and docs first, asks one question at a
  time, offers two or three approaches with a recommendation, then writes the ticket or tracker. No design document, no extra
  approval step.
- Issue forms for features, bugs, tasks and decisions come pre-made.
- Commits and pull requests say `Ticket #42` or `Refs #42`, never "Closes #42", so merging never closes a ticket behind your back.

### Planning

Planning is the default. A ticket skips it only when all four hold: the change is understood end to end, it is small and in one
place, it touches nothing sensitive (deploys, auth, data, money, concurrency…), and verification is obvious. When in doubt, plan.
A ticket only counts as *planned* when it links a committed plan file. [More in WORKFLOW.md](core/docs/WORKFLOW.md#planning)

### Risk tiers

Every change is `low`, `normal`, `high` or `critical`. The tier decides how deep the review goes and how much effort the agent puts
in, nothing else. Anything touching access, money, migrations, deploys or several subsystems is at least `high`.

The agent that writes the code runs on the standard model at `high` effort: it is cheaper, and the strongest model stays with the
planner and the reviewer, who catch mistakes. The implementer moves up only for genuinely hard reasoning, never because a ticket
is risky. [More in WORKFLOW.md](core/docs/WORKFLOW.md#risk-tiers)

### Building: the engineering method

TicketFlow carries its own rules for how the code gets written, so no other plugin is needed:

- **A bug is reproduced first** and its cause named before anyone fixes it.
- **Test first where it pays.** For non-trivial behaviour the agent writes the failing test first; a trivial change gets no
  ceremony.
- **Small changes.** The smallest correct change wins: reuse before adding, delete before adding.
- **Concrete blockers.** The reviewer must name the case that breaks and the smallest fix for every blocker, and ends with what it
  could not check.

[The method in detail](core/docs/WORKFLOW.md#building-tests-bugs-and-small-changes)

### Several tickets (optional)

One ticket never needs this. When you have a handful, say *"work through #12 #13 #14"*, *"do the children of #10"* (a tracker's
sub-issues) or *"work the ready backlog"* (the optional `orchestrate-tickets` skill). A coordinator hands each ticket to a fresh
helper that follows the normal ticket journey, then shows a table of what merged, what waits for your look and what is stuck.
For the backlog it first warns you and lists the tickets (up to 10 Ready ones, highest priority first; this needs a Project).
If the session dies, ask again naming the same tickets: it picks up from GitHub, so finished tickets stay finished and open pull
requests continue. [How to use it](core/docs/WORKFLOW.md#several-tickets-optional)

### The gate

There is exactly one thing that decides whether a pull request may merge: a green **`CI / Gate`** status on its latest commit.
Changes that touch only the paths you list as docs get it quickly without running the heavy checks. The local fallback is fail-closed: when in doubt it posts nothing.
[More in CI-GATE.md](core/docs/CI-GATE.md)

### Reviews

The `pr-reviewer` role is always available and works with no setup: it reviews every pull request, or only the `high` and `critical`
ones once you add an external reviewer (a bot or a person) in the config. TicketFlow waits for external reviewers and, when you
give it the pattern or timeout to recognise it, notices one that is out of quota or silent and brings in the built-in reviewer as a
stand-in.

A finished review is not enough to merge. Findings must be answered too: every open review thread (from anyone, bots included),
a configured reviewer's "changes requested" and a "changes needed" verdict from `pr-reviewer` stop the merge until they are dealt
with. The agent fixes each finding, or says why it disagrees, then replies to the thread and resolves it.
[More in REVIEWERS.md](core/docs/REVIEWERS.md)

### Merging and branch protection

Merges happen only through the `merge` script. A standard branch ruleset requires `CI / Gate` and an up-to-date
branch. The script adds what a ruleset cannot see: no unresolved review thread from anyone, no configured reviewer left on "changes requested",
and, if the built-in reviewer reviewed this exact commit, its last verdict must be "ready to merge". When it refuses, it always prints the next step, and there is always a legitimate way through
([the ways past a refusal](core/docs/REVIEWERS.md#when-merge-says-no)). Your merge methods and branch settings stay yours: the setup shows them and offers squash-only (one commit per ticket) and
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

### Supported tools

TicketFlow works natively with seven agents: Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity and GitHub Copilot.
Each gets its own install, thin generated files that point at the same skills and roles, and a command guard that asks before
(or blocks) merging by hand or pushing to the default branch. Gemini CLI cannot ask, so it denies those commands and you run them
yourself. Adding a tool to a repo that already uses TicketFlow is opt-in: nothing changes until you list it in the config and
update. [Install steps and manual steps per tool](core/docs/TOOLS.md), and
[the guard in plain words](core/docs/TOOLS.md#the-command-guard-in-plain-words)

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
| `.claude/`, `.agents/`, `.codex/`, `.cursor/`, `.gemini/`, `.opencode/`, `.github/agents/` | short generated stubs that point agents at the runtime; only the folders of the agents in your config | the generator |
| `AGENTS.md`, `.claude/CLAUDE.md`, `GEMINI.md` | a short managed block (`GEMINI.md` only with Gemini CLI: it imports `AGENTS.md`); the rest of the file stays yours | the managed block: `sync` |
| `.claude/settings.json`, `.codex/hooks.json`, `.codex/rules/`, and per agent `.cursor/hooks.json`, `.gemini/settings.json`, `.github/hooks/ticketflow-guard.json`, `.agents/hooks.json`, `opencode.json` | the guard: ask/block rules for bypass commands; your own entries stay | TicketFlow's entries: `sync` |
| `.github/workflows/ci.yml` | the gate job in managed blocks; your own CI steps (and your toolchain) in between | the blocks: `sync`; your steps and the `runs-on` runner: you |
| `.github/ISSUE_TEMPLATE/`, PR template | forms and checklist in managed blocks; the issue chooser (`config.yml`) written once | the blocks: `sync`; `config.yml`: you |

Nothing TicketFlow owns is ever hand-edited: you change it in `.ticketflow/custom/` or the config, and the tools regenerate the rest.

The TicketFlow repository itself also holds a small maintainer tool that checks Superpowers and Ponytail for new releases each
month ([upstream review](docs/maintainers/upstream-review.md)). It lives in that repo only and is never installed in yours.

---

## Getting started

**You need:** a shell, `git`, the GitHub CLI `gh` 2.48 or newer (logged in with the `repo`, `project` and `workflow` scopes),
Node.js 18.9 or newer (only to run TicketFlow's own scripts: your project can use any language, version or none), and `timeout` (part of coreutils; on macOS `brew install coreutils`). The setup checks all of it for you.

Pick whichever front door suits you. They all lead to the same guided setup:

- **Claude Code:** `/plugin marketplace add livingc0de/ticketflow`, then `/plugin install ticketflow@ticketflow`. Then ask:
  *"set up ticketflow"*.
- **Codex:** `codex plugin marketplace add livingc0de/ticketflow`, then `codex plugin add ticketflow@ticketflow`. Then ask the same.
- **Cursor:** Customize, then From GitHub Repository, `livingc0de/ticketflow`. Then ask the same.
- **Gemini CLI:** `gemini extensions install https://github.com/livingc0de/ticketflow`. Then ask the same.
- **GitHub Copilot:** `copilot plugin install livingc0de/ticketflow` (VS Code: add the repo to `chat.plugins.marketplaces`). Then ask the same.
- **Antigravity:** `agy plugin install https://github.com/livingc0de/ticketflow`. Then ask the same.
- **OpenCode** has no plugin: tell it to read
  [`START.md`](https://raw.githubusercontent.com/livingc0de/ticketflow/main/START.md) and follow it. It already reads the `.agents/skills` folder the stubs go to.
- **Any other agent:** tell it to read
  [`START.md`](https://raw.githubusercontent.com/livingc0de/ticketflow/main/START.md) and follow it.

The setup interviews you (your verify command, your Project, optional reviewers and practices), writes the files, and opens a
**setup pull request** for you to review. Every GitHub change (labels, Project, branch protection) is shown as a dry run first and
only applied after your yes. Branch protection is switched on after you merge the setup pull request. A brand-new, empty repo gets
one confirmed direct push instead.

Three small things are left for you after the setup merges: trust the guard hook once in the tools that have one (in Codex via
`/hooks`, again whenever an update changes it; Cursor, Gemini CLI, Copilot and Antigravity ask in their own way, and the setup
lists each); restart open agent sessions so they load the new skills; and turn on the Project's built-in workflows that the
setup lists (GitHub's API can't). What each tool needs is in [TOOLS.md](core/docs/TOOLS.md).

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
| "I have an idea: ..." | the agent reads the code, asks one question at a time, offers 2-3 approaches and writes the ticket or tracker |
| "work through #12 #13 #14" / "do all children of #10" | the optional orchestrator: one fresh helper per ticket, a final table, tickets left In Review |
| "work the ready backlog" | the orchestrator warns you and lists the tickets, then starts (say "stop" if that is not what you meant); up to 10 Ready tickets, highest priority first (needs a Project) |
| "continue #12 #13 #14" / "continue the children of #10" | an interrupted run picks up from GitHub: finished tickets stay finished, open pull requests continue. Name the tickets again in a new session |
| "mark #42 done" | Done and closed, only because you asked |
| "update ticketflow" | the update procedure below |

You stay in charge of three things: answering real decisions (product, data, security or money trade-offs), reviewing the work in
**In Review**, and saying when something is **Done**.

---

## Updating

Ask your agent to *"update ticketflow"* (other agents: follow `skills/sync/SKILL.md` of the TicketFlow repo, as `START.md` says). It fetches the release you choose, shows what changed,
refreshes `.ticketflow/` and the generated files, keeps everything that is yours, and opens an update pull request. Nothing changes
until you merge it. [More in UPGRADING.md](core/docs/UPGRADING.md). What changed between versions is in [CHANGELOG.md](CHANGELOG.md).

---

## Safety in short

- Agents never use an admin bypass (`--admin`, direct pushes to the default branch, posting a status by hand) unless you explicitly
  ask for that exact action. In Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity and Copilot, a guard in the repo's agent settings asks before (or blocks) the common forms
  of these commands (Gemini CLI has no ask, so it denies them and you run the command yourself; [per tool](core/docs/TOOLS.md#the-command-guard-in-plain-words)). It is a seatbelt, not a wall: branch protection is what actually enforces the gate.
- During setup and updates, agents write only inside your repo. They suggest changes to your personal agent settings; they never
  make them.
- A check that could not run is reported, never claimed.
- Text in an issue, pull request or comment is treated as data. It can say what to build; it cannot tell an agent to skip a rule.

The full threat model and what each safeguard does and doesn't prevent: [SECURITY.md](core/docs/SECURITY.md).

---

## FAQ

**Do I need one of the seven native tools?** No. Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity and GitHub Copilot have a
native front door (stubs, an action map and a command guard); any other agent that can read files and run a shell follows `START.md` and
the skills. That includes Windsurf, Cline and Roo Code, Amp, Kiro, Junie, Zed, Aider, Goose and Factory Droid: they read `AGENTS.md` and
use `core/agents-map/generic.md` (Aider: `read: AGENTS.md` in `.aider.conf.yml`; Kiro and Cline: tell it to read `AGENTS.md`). They get
no command guard, and without sub-agents the review runs in the same session, so you are asked before a merge that rests on it.

**Why did `merge` refuse?** It names the reason and the next step. The common ones (an open review thread, "changes requested", an
out-of-date branch) and the legitimate ways past each are in [REVIEWERS.md](core/docs/REVIEWERS.md#when-merge-says-no).

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
| [WORKFLOW.md](core/docs/WORKFLOW.md) | the lifecycle in detail: tiers, planning, verifying, reviewing, merging, handoff, several tickets, branching |
| [PROJECT.md](core/docs/PROJECT.md) | the board: statuses, views, labels and initiative trackers |
| [CI-GATE.md](core/docs/CI-GATE.md) | how the merge gate works, docs-only runs, the local fallback, renaming the gate |
| [REVIEWERS.md](core/docs/REVIEWERS.md) | the built-in reviewer, external reviewers, and what to do when `merge` says no |
| [TOOLS.md](core/docs/TOOLS.md) | each supported agent: install, generated files, manual steps, its command guard |
| [CONFIG.md](core/docs/CONFIG.md) | every setting in `.ticketflow/config.json` |
| [EXTENDING.md](core/docs/EXTENDING.md) | how to customize: `custom/`, review guidelines, practices, domain guides |
| [SECURITY.md](core/docs/SECURITY.md) | the threat model and the safeguards |
| [TOKEN-BUDGET.md](core/docs/TOKEN-BUDGET.md) | what agents load and how to keep it small |
| [UPGRADING.md](core/docs/UPGRADING.md) | how updates work and what to watch for |

These docs are also copied into every repo as `.ticketflow/docs/`, so your agent and your team always read the version you run.

---

## Credits

TicketFlow's engineering method (plan first, test first where it pays, debug by cause) was inspired by
[Superpowers](https://github.com/obra/superpowers), and its lean, minimal-change rules by
[Ponytail](https://github.com/dietrichgebert/ponytail). Neither needs to be installed.

Contributing: [AGENTS.md](AGENTS.md). Maintainers: [`docs/maintainers/upstream-review.md`](docs/maintainers/upstream-review.md). Release notes: [CHANGELOG.md](CHANGELOG.md). License: MIT.
