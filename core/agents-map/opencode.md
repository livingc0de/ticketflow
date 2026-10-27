# Action map: OpenCode

The canonical skills and roles name actions. In OpenCode, do them like this. `config.models.opencode` maps a model class (`strong`, `standard`, `light`) to a `provider/model` id; a `null` id means: leave `model` out.

| Action | How |
|---|---|
| Dispatch the `<role>` role | V2: the `subagent` tool with agent `<role>`. V1: the `task` tool with `subagent_type: "<role>"`. The repo's agents are in `.opencode/agents/` |
| Dispatch a helper of a class | Agent `general` for work, `explore` for broad read-only search; the model comes from the agent, or the parent can name it |
| Dispatch a fresh ticket lead | V2 `subagent` with agent `general`, V1 `task`; brief it fully, it has no context |
| Run in the background and wait once | V2: `shell` with `background: true`, then wait for the result. V1: the `bash` tool with a long `timeout` (the default is 2 minutes) |
| Ask the user | The `question` tool, one targeted question, then wait |
| Track tasks | V1 `todowrite`; V2 a checklist in your reply |
| Load a skill | The `skill` tool with the skill's name (skills are in `.agents/skills/`) |
| Switch model or effort | You cannot change your own: say what the user should run (`/models`), or hand the hard part to an agent with its own `model` |

## Rules

- Nesting: V2 allows depth 1 (a lead cannot dispatch); treat V1 as none. A refused dispatch: do the step inline and say so; a lead reports `needs-review`.
- Limits: none to set.
- The guard is the `ask` rules ticketflow merged into `opencode.json` (`permission.bash` in V1, `permissions` in V2): a merge, a push to the default branch or a protection change prompts the user. OpenCode has no hook, so these ask rules are the whole guard. Do not look for a way around them.
