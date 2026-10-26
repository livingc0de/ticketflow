# Action map: Claude Code

The canonical skills and roles name actions. In Claude Code, do them like this. `config.models.claude` maps a model class (`strong`, `standard`, `light`) to a model id; a `null` id means: leave `model` out.

| Action | How |
|---|---|
| Dispatch the `<role>` role | Agent tool with `subagent_type: "<role>"` (the repo's agent in `.claude/agents/`). Its model and effort come from its frontmatter; pass `effort` only when the skill asks for an override |
| Dispatch a helper of a class | `Explore` for broad read-only search, `general-purpose` for work; `model` from `config.models.claude[<class>]`, and an explicit `effort` |
| Dispatch a parallel ticket worker | `general-purpose`, `model` of the standard class, explicit `effort`; give it the path of the ticket's worktree and brief it fully, it has no context |
| Run in the background and wait once | Bash with `run_in_background: true`; you are notified when it exits. Do not poll and do not sleep-loop |
| Ask the user | Ask one targeted question in the reply (the question tool if it is available) and wait |
| Track tasks | `TaskCreate` / `TaskUpdate` (or `TodoWrite`), one task per plan task |
| Load a skill | Skill tool with the skill's name |
| Switch model or effort | You cannot change your own: say what the user should run (`/model`, `/effort`), or hand the hard part to a dispatched agent with its own `model` and `effort` |

## Rules

- Never use Plan Mode for ticket work: planning is a dispatched role, and it needs no approval step.
- Subagents do not see this conversation. Brief them with the ticket number, the files, the rule on scope, and the exact report you want; never a transcript.
- A dispatched agent cannot dispatch further agents. If a role would need to, run that step yourself.
