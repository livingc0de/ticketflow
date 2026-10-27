# Action map: Codex

The canonical skills and roles name actions. In Codex, do them like this. `config.models.codex` maps a model class (`strong`, `standard`, `light`) to a model id; a `null` id means: do not pass `model`.

| Action | How |
|---|---|
| Dispatch the `<role>` role | `spawn_agent` with `agent_type: "<role>"` (the repo's agent in `.codex/agents/`) without forking (`fork_context` false; V2 `fork_turns: "none"`), then wait for it. If you cannot dispatch, follow the generic map (inline) |
| Dispatch a helper of a class | `spawn_agent` without forking (`fork_context` false; V2 `fork_turns: "none"`) and both `model` (from `config.models.codex[<class>]`) and `reasoning_effort` set |
| Dispatch a fresh ticket lead | `spawn_agent` without forking (`fork_context` false; V2 `fork_turns: "none"`), `model` and `reasoning_effort` of the standard class; brief it fully, it has no context |
| Run in the background and wait once | Run it in the foreground: the ticketflow scripts are bounded by their own timeouts |
| Ask the user | Ask one targeted question in the reply and wait |
| Track tasks | `update_plan` |
| Load a skill | Open the skill's `SKILL.md` named by the stub and follow it |
| Switch model or effort | You cannot change your own: say what the user should set, or hand the hard part to a dispatched agent |

## Rules

- Codex asks before the forms in `.codex/rules` (a merge, a push to the default branch, a protection change); a hook blocks the rest. Do not look for a way around either: when a step needs one, stop and ask the user. After the hook file changes, the user must trust it again with `/hooks`.
- Nesting: `agents.enabled` is on by default. V1 allows depth 1 (a lead cannot dispatch) unless `agents.max_depth = 2`; V2 ignores `max_depth`. A refused dispatch: do the step inline and say so; a lead that cannot dispatch reports `needs-review` and the orchestrator dispatches the reviewer.
- Limits: suggest to the user, never write, `agents.max_depth = 2` and `agents.max_concurrent_threads_per_session = <B-1>`. Defaults: 6 threads in V1, 4 in V2; V2 has no depth cap, so `max_depth` does not limit it.
- Loaded by another tool (Cursor, Copilot and OpenCode also read `.claude/`; Cursor reads `.codex/agents`)? Use `.ticketflow/agents-map/<your tool>.md`, or `generic.md`.
- A spawned agent does not see this conversation. Brief it with the ticket number, the files, the rule on scope, and the exact report you want.
