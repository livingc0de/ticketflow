# Action map: Gemini CLI

The canonical skills and roles name actions. In Gemini CLI, do them like this. `config.models.gemini ?? config.models.default` maps a model class (`strong`, `standard`, `light`) to a model id or native alias (`pro`, `flash`, `flash-lite`); a `null` id means: leave `model` out.

Treat versionless values as model-family hints. Before passing a configured model to Gemini, keep Gemini-native aliases such as `pro`, `flash` and `flash-lite` when Gemini accepts them; otherwise resolve them to the current full model id. This applies to role frontmatter and helper or lead dispatches. Do not invent a version when the tool cannot resolve the hint; use the current session model instead.

| Action | How |
|---|---|
| Dispatch the `<role>` role | Call the `<role>` tool (the repo's agent in `.gemini/agents/`), or `@<role>` in a prompt. Its model comes from its frontmatter; resolve the model hint if Gemini requires a full id; there is no effort setting |
| Dispatch a helper of a class | `generalist` for work, `codebase_investigator` for broad read-only search; the model is set per agent, not per call |
| Dispatch a fresh ticket lead | `generalist`; brief it fully, it has no context. It cannot dispatch (see Nesting) |
| Run in the background and wait once | Run it in the foreground. A command silent for 300 s is cut off by the inactivity timeout: run the stateless script again |
| Ask the user | The `ask_user` tool, one targeted question, then wait |
| Track tasks | `write_todos`, one item per plan task |
| Load a skill | The `activate_skill` tool with the skill's name (the user approves it once) |
| Switch model or effort | You cannot change your own: say what the user should run (`/model`), or hand the hard part to a role with its own `model` |

## Rules

- Nesting: none; subagents cannot call subagents. A refused dispatch: do the step inline and say so; a lead plans inline and reports `needs-review`, and the orchestrator dispatches the reviewer.
- Limits: none to set. Suggest `tools.shell.inactivityTimeout` of at least 3000 (seconds) in the user's settings, never write it.
- The command guard is a `BeforeTool` hook in `.gemini/settings.json`. Gemini has no ask: a merge, a push to the default branch or a protection change is denied, so ask the user to run it. The user approves the project hook once. Do not look for a way around it.
- Gemini reads `GEMINI.md`, which imports `AGENTS.md`.
