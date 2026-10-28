# Action map: Antigravity

The canonical skills and roles name actions. In Antigravity, do them like this. `config.models.antigravity ?? config.models.default` maps a model class (`strong`, `standard`, `light`) to a tier (`pro` or `flash`); a `null` means: do not choose.

Treat versionless values as model-family or tier hints. Before passing a configured model to Antigravity, keep an Antigravity-native tier such as `pro` or `flash` when it accepts it; otherwise resolve the hint to the current full model id. This applies to role dispatches and helper or lead dispatches. Do not invent a version when the tool cannot resolve the hint; use the current session model instead.

| Action | How |
|---|---|
| Dispatch the `<role>` role | `invoke_subagent` with the built-in `self` (it has your tools, so a role can run `gh` and `node`) and a brief: read `.ticketflow/agents/<role>.md`, follow it (a read-only role stays read-only: say so in the brief), and report in the size it asks. There are no custom role files |
| Dispatch a helper of a class | `invoke_subagent` with `research` for broad read-only search (it may not run commands) or `self` for work; the tier from `(config.models.antigravity ?? config.models.default)[<class>]` |
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
