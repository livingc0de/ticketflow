# Action map: Antigravity

The canonical skills and roles name actions. In Antigravity, do them like this. `config.models.antigravity` maps a model class (`strong`, `standard`, `light`) to a tier (`pro` or `flash`); a `null` means: do not choose.

| Action | How |
|---|---|
| Dispatch the `<role>` role | `invoke_subagent` with the built-in `research` (read-only roles) or `self` (roles that write), and a brief: read `.ticketflow/agents/<role>.md`, follow it, and report in the size it asks. There are no custom role files |
| Dispatch a helper of a class | `invoke_subagent` with `research` for broad read-only search or `self` for work; the tier from `config.models.antigravity[<class>]` |
| Dispatch a fresh ticket lead | `invoke_subagent` with `self`, the standard tier; brief it fully, it does not inherit this history |
| Run in the background and wait once | Subagents are asynchronous: start it, then wait for its result message. Do not poll |
| Ask the user | Ask one targeted question in the reply and wait |
| Track tasks | A checklist in your reply, updated as you go |
| Load a skill | Antigravity lists the skills in `.agents/skills/`; read the skill's `SKILL.md` named by the stub and follow it |
| Switch model or effort | You cannot change your own: say what the user should pick in the model menu, or hand the hard part to a subagent |

## Rules

- Nesting: up to 10 levels. A refused dispatch: do the step inline and say so; a lead that cannot dispatch reports `needs-review`.
- Limits: none documented.
- The command guard is a `PreToolUse` hook in `.agents/hooks.json` (`ticketflow-guard`): it forces a prompt for a merge, a push to the default branch or a protection change and denies the rest. Check it with `/hooks`. Do not look for a way around it; ask the user.
