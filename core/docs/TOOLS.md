# Agent tools

TicketFlow works with seven coding agents out of the box, and with any other agent that can read files and run a shell. This page
is for the moment you pick a tool, add one later, or wonder why a tool asked or refused something. For each tool it says how to
install the plugin (`<owner>/ticketflow` stands for the TicketFlow repository you install from; the README of that repository
has the exact commands), what lands in your repo, what you still do by hand, and how its command guard behaves.

**The seven:** Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity and GitHub Copilot. Each gets thin generated files that
point at the same skills and roles, a short action map (how "dispatch the reviewer" is done in that tool) and a command guard.

**Any other agent** (Windsurf, Cline, Roo Code, Amp, Kiro, Junie, Zed, Aider, Goose, Factory Droid and so on) reads `AGENTS.md`
and follows `START.md`. It has no command guard, and without sub-agents the review runs in the same session, so you are asked
before a merge that rests on it.

## What every tool gets

- **Skills** in `.claude/skills/` (Claude Code) or the shared `.agents/skills/` folder (every other tool). One stub per skill, so
  two tools in one repo never fight over a file.
- **Roles** (the planner and the reviewer) in the tool's own agents folder: `.claude/agents/`, `.codex/agents/`, `.cursor/agents/`,
  `.gemini/agents/`, `.opencode/agents/` or `.github/agents/`. Antigravity has no role files: its roles run as built-in subagents.
- **A short block** in `AGENTS.md` (and `.claude/CLAUDE.md`; for Gemini CLI a `GEMINI.md` that imports `AGENTS.md`).
- **A command guard**, described below.

You never edit these files. `sync` and the generators rebuild them; your own changes go in `.ticketflow/custom/`
([EXTENDING.md](EXTENDING.md)).

## Tool by tool

### Claude Code

- **Install:** `/plugin marketplace add <owner>/ticketflow`, then `/plugin install ticketflow@ticketflow`. Ask: "set up ticketflow".
- **Files:** `.claude/skills/`, `.claude/agents/`, `.claude/CLAUDE.md`, `.claude/settings.json`.
- **By hand:** restart the session so the new skills and agents load.
- **Guard:** ask rules in `.claude/settings.json`. Claude Code stops and asks you before a command in the guard list. It never
  blocks outright, because that would also block you when you really want the command.
- **Several tickets:** a ticket lead can run its own planner and reviewer (Claude Code 2.1.219 or newer).

### Codex

- **Install:** `codex plugin marketplace add <owner>/ticketflow`, then `codex plugin add ticketflow@ticketflow`. Ask the same.
- **Files:** `.agents/skills/`, `.codex/agents/*.toml`, `.codex/hooks.json`, `.codex/rules/ticketflow.rules`.
- **By hand:** trust the project and the hook with `/hooks` (again whenever an update changes the hook). Optional: for ticket leads
  that dispatch their own planner and reviewer, set `agents.max_depth = 2` under `[agents]` in your user config.
- **Guard:** prompt rules ask before the common forms, and a hook blocks the forms nobody should run through an agent.

### Cursor

- **Install:** Customize, then From GitHub Repository, `<owner>/ticketflow`. Ask: "set up ticketflow".
- **Files:** `.agents/skills/`, `.cursor/agents/`, `.cursor/hooks.json`.
- **By hand:** trust the workspace once (the guard hook runs after that); reload Cursor.
- **Guard:** a hook asks before the common forms and denies the rest. A command that does not contain `gh`, `git` or `protect.mjs`
  never reaches the hook.

### Gemini CLI

- **Install:** `gemini extensions install https://github.com/<owner>/ticketflow`. Ask the same.
- **Files:** `.agents/skills/`, `.gemini/agents/`, `.gemini/settings.json`, `GEMINI.md`.
- **By hand:** approve the project hook and the skills when Gemini asks. Optional: set `tools.shell.inactivityTimeout` to 3000 or
  more in your user settings, so a long verify command is not cut off.
- **Guard:** Gemini CLI has no "ask" prompt, so the hook **denies** every guarded command, including the ones other tools ask
  about. When you do want such a command, run it yourself in a terminal.
- **Several tickets:** Gemini subagents cannot dispatch more subagents, so a lead plans inline and reports `needs-review`; the
  orchestrator then runs the reviewer.

### OpenCode

- **Install:** there is no plugin. Tell OpenCode to read [`START.md`](https://raw.githubusercontent.com/<owner>/ticketflow/main/START.md)
  and follow it. It already reads the `.agents/skills/` folder.
- **Files:** `.agents/skills/`, `.opencode/agents/`, and ask rules merged into `opencode.json`.
- **By hand:** restart OpenCode. If you use `opencode.jsonc` instead, the setup shows the ask rules and you add them yourself.
- **Guard:** ask rules only (OpenCode has no hook), so it prompts you before the guarded commands. If you run OpenCode with auto-approval (`--auto`), its prompts are approved and
  the guard does nothing. Where one of your own denies overlaps a TicketFlow ask rule, the ask is left out and the setup says so.
  Hard denies you want belong in
  the project's `opencode.json`.

### Antigravity

- **Install:** `agy plugin install https://github.com/<owner>/ticketflow`. Ask the same.
- **Files:** `.agents/skills/` and `.agents/hooks.json`. No role files (see above).
- **By hand:** restart, then check that `/hooks` lists `ticketflow-guard`.
- **Guard:** a hook that forces a prompt for the common forms and denies the rest.

### GitHub Copilot

- **Install:** `copilot plugin install <owner>/ticketflow`. In VS Code add the repo to `chat.plugins.marketplaces`.
- **Files:** `.agents/skills/`, `.github/agents/*.agent.md`, `.github/hooks/ticketflow-guard.json`.
- **By hand:** trust the folder (CLI). In VS Code enable the Run Subagent tool, and nested subagents if you want ticket leads to
  dispatch their own planner and reviewer.
- **Guard:** a hook asks before the common forms. The Copilot cloud agent cannot be asked, so there the guarded commands are
  denied. The cloud agent also pushes only to `copilot/*` branches, so it is never an orchestrator or a ticket lead.

## What is verified

"Supported" can mean very different things, so this matrix says what was actually checked, per tool (as of 2026-10-27).

- **live**: run inside the tool and the result observed.
- **fixture**: covered by TicketFlow's tests with fakes, or by the tool's own checker, but never run inside the tool.
- **documented**: written from the tool's documentation, never run.
- **unsupported**: the tool cannot do it; the fallback is in the notes.

| | Claude Code | Codex | Cursor | Gemini CLI | OpenCode | Antigravity | Copilot | Any other |
|---|---|---|---|---|---|---|---|---|
| Install path | documented | documented | documented | documented | documented | documented | documented | documented |
| Generated files | fixture | fixture | fixture | fixture | fixture | fixture | fixture | documented |
| Skills load and are followed | live | documented | documented | documented | documented | documented | documented | documented |
| Roles (planner, reviewer) | live | documented | documented | documented | documented | documented | documented | unsupported |
| A lead dispatches roles | documented | documented | documented | unsupported | unsupported | documented | documented | unsupported |
| Command guard | live | fixture | fixture | fixture | fixture | fixture | fixture | unsupported |
| The method without a ticket | documented | documented | documented | documented | documented | documented | documented | documented |

Evidence and fallbacks:

- **Live** is Claude Code only. This repository's own tickets (#32 onward) are delivered with the skills and the planner and reviewer
  roles, and in a checkout with the rendered rules the ask rules refused `gh pr merge --admin`, a push to the default branch and
  `protect --apply` (not checked under `bypassPermissions`; [SECURITY.md](SECURITY.md#agent-side-checks)).
- **Generated files** are fixture-tested for every tool (`gen-stubs` and `render` tests), and end to end with `doctor --local` for
  Claude Code and Codex; no run of the plugin install commands is recorded for any tool.
- **Codex guard:** `codex execpolicy check` loads the generated rules and decides as the guard's examples say; the hook itself was not
  run end to end. **The other five guards:** the hook scripts and the OpenCode ask rules are tested against the same examples; none
  was run inside its tool.
- **Antigravity** has no role files; its roles run as built-in subagents. **Any other agent** has no sub-agents and no guard: the
  review runs in the same session and you are asked before a merge that rests on it.
- **A lead dispatches roles** follows each tool's documentation ([WORKFLOW.md](WORKFLOW.md#several-tickets-optional)); no run has
  counted nested agents. Copilot allows it in VS Code only (the cloud agent never). Where it is unsupported, a lead plans inline and
  reports `needs-review`.
- **The method without a ticket** (the `engineering-method` skill) is new in 0.3.5; no paid agent run has measured it yet.
- **Usage and transcripts** (for "why did that run cost so much"): TicketFlow ships no counter and no per-tool command for them. The agent reads
  what the tool itself keeps, and says so when it keeps nothing ([TOKEN-BUDGET.md](TOKEN-BUDGET.md#measuring)). A documented gap, not a verified feature.

## Adding a tool to a repo that already uses TicketFlow

Nothing changes until you ask. A repo set up for Claude Code and Codex gets none of the new tools' files after an update. To add a tool:

1. In `.ticketflow/config.json` add its name to `agents` (`cursor`, `gemini`, `opencode`, `antigravity` or `copilot`) and a
   `models.<tool>` entry. Use `null` for each model class to let the tool pick its own; Copilot model names contain spaces, so
   `null` is the right value there ([CONFIG.md](CONFIG.md)).
2. Ask your agent to *"update ticketflow"* (or run `gen-stubs` and `render`, which write the files listed above).
3. Do the "by hand" steps of that tool, usually trusting its guard hook once.
4. `node .ticketflow/scripts/doctor.mjs --local` should report no failures.

## The command guard, in plain words

A guard watches for five kinds of command that skip TicketFlow's checks:

- `gh pr merge`, which skips the merge script's checks;
- a merge through the GitHub API;
- a gate status posted by hand, which would forge a green gate;
- a push straight to the default branch;
- a change to branch protection (`protect.mjs --apply`).

What happens depends on the tool:

| Tool | Common forms | Forms nobody should run through an agent |
|---|---|---|
| Claude Code | asks you | asks you |
| Codex | asks you | blocked |
| Cursor | asks you | denied |
| Gemini CLI | denied (no ask exists) | denied |
| OpenCode | asks you | asks you |
| Antigravity | asks you | denied |
| GitHub Copilot | asks you (cloud agent: denied) | denied |

The guard is a seatbelt, not a wall. A script that hides the command, `git -C <dir> push` and several other spellings get past
it; branch protection and the merge script are what actually enforce the rules. The honest list of gaps, per tool, is in
[SECURITY.md](SECURITY.md#per-tool-guard). None of the four hooks or the OpenCode rules has been run inside the tool itself yet;
they follow each tool's documentation and TicketFlow's own tests.

## Several tickets in each tool

Whether a ticket lead can dispatch its own helpers differs by tool. The table is in
[WORKFLOW.md](WORKFLOW.md#several-tickets-optional). Where a lead cannot dispatch, the work still gets done: it plans inline and
the orchestrator brings in the reviewer.
