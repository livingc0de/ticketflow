# Action map: Codex

The canonical skills and roles name actions. In Codex, do them like this. `config.models.codex` maps a model class (`strong`, `standard`, `light`) to a model id; a `null` id means: do not pass `model`.

| Action | How |
|---|---|
| Dispatch the `<role>` role | `spawn_agent` with `agent_type: "<role>"` (the repo's agent in `.codex/agents/`) and `fork_turns: "none"`, then wait for it. Needs `[features] multi_agent = true` in the Codex config: suggest it to the user, never write it yourself. If you cannot dispatch, follow the generic map (inline) |
| Dispatch a helper of a class | `spawn_agent` with `fork_turns: "none"` and both `model` (from `config.models.codex[<class>]`) and `reasoning_effort` set |
| Dispatch a parallel ticket worker | Same, in its own git worktree: give it the worktree path and the brief; it has no context |
| Run in the background and wait once | Run it in the foreground: the ticketflow scripts are bounded by their own timeouts |
| Ask the user | Ask one targeted question in the reply and wait |
| Track tasks | `update_plan` |
| Load a skill | Open the skill's `SKILL.md` named by the stub and follow it |
| Switch model or effort | You cannot change your own: say what the user should set, or hand the hard part to a dispatched agent |

## Rules

- Codex asks before the forms in `.codex/rules` (a merge, a push to the default branch, a protection change); a hook blocks the rest. Do not look for a way around either: when a step needs one, stop and ask the user. After the hook file changes, the user must trust it again with `/hooks`.
- A spawned agent does not see this conversation. Brief it with the ticket number, the files, the rule on scope, and the exact report you want.
