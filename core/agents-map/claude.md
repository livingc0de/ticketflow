# Action map: Claude Code

`config.models.claude ?? config.models.default` maps a class (`strong`, `standard`, `light`) to a model id; `null` means leave `model` out. Pass a Claude-native alias (`opus`, `sonnet`, `haiku`) when it is accepted, else the current full id; never invent a version, use the session model instead.

| Action | How |
|---|---|
| Dispatch the `<role>` role | Agent tool, `subagent_type: "<role>"` (`.claude/agents/`); model and effort come from its frontmatter. To override a class or effort pass `model` (the alias of `(config.models.claude ?? config.models.default)[<class>]`) and `effort` |
| Dispatch a helper of a class | `Explore` for broad read-only search, `general-purpose` for work, with `model` of the class and an explicit `effort` |
| Dispatch a fresh ticket lead | `general-purpose`, `model` of the standard class, an explicit `effort`, never a fork; brief it fully, it has no context |
| Wait for a script | Bash in the foreground with `timeout: 600000` and the script's `--timeout-min 9`; on exit 2 with a timeout run it again. Never sleep or poll |
| Run in the background and wait once (a long verification) | Bash with `run_in_background: true`; you are notified when it exits. Do not poll and do not sleep-loop |
| Ask the user | One targeted question in the reply (the question tool if available); wait |
| Track tasks | `TaskCreate` / `TaskUpdate` (or `TodoWrite`), one per plan task |
| Load a skill | Skill tool with the skill's name |
| Switch model or effort | You cannot; say what the user should run (`/model`, `/effort`) or hand the hard part to a dispatched agent with its own `model` and `effort` |

- Never use Plan Mode for ticket work: planning is a dispatched role and needs no approval step.
- Subagents do not see this conversation: brief them with facts (ticket number, files, the scope rule, the exact report wanted), never a transcript.
- A dispatched `general-purpose` agent can dispatch further agents; the read-only role agents cannot. A refused dispatch: do the step inline and say so. Suggest to the user, never write, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2` and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=<B-1>`.
- Loaded by another tool (Cursor, Copilot and OpenCode also read `.claude/`; Cursor reads `.codex/agents`)? Use `.ticketflow/agents-map/<your tool>.md`, or `generic.md`.
