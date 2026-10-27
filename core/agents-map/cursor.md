# Action map: Cursor

The canonical skills and roles name actions. In Cursor, do them like this. `config.models.cursor` maps a model class (`strong`, `standard`, `light`) to a model id; a `null` id means: leave `model` out (the subagent inherits).

| Action | How |
|---|---|
| Dispatch the `<role>` role | Task tool with the subagent named `<role>` (the repo's agent in `.cursor/agents/`, which wins over `.claude/` and `.codex/`). Its model comes from its frontmatter; the effort follows the model |
| Dispatch a helper of a class | Task tool: `Explore` for broad read-only search, a generic subagent for work; name the model from `config.models.cursor[<class>]` when it is not `null` |
| Dispatch a fresh ticket lead | Task tool, a generic subagent, the standard-class model, never resumed; brief it fully, it has no context |
| Run in the background and wait once | Run it in the foreground; on a timeout run it again (the ticketflow scripts are stateless and bounded) |
| Ask the user | The ask-questions tool, one targeted question, then wait |
| Track tasks | The to-do checklist, one item per plan task |
| Load a skill | Skills load automatically or with `/<name>`; otherwise open the skill's `SKILL.md` named by the stub |
| Switch model or effort | You cannot change your own: say what the user should pick in the model menu, or hand the hard part to a subagent with its own model |

## Rules

- Roles are `.cursor/agents/` files. If both `.claude/` and `.cursor/` stubs exist, use the `.cursor/` one; both point at the same canonical file.
- Nesting: a direct subagent can launch one more level (depth 2 fits, since Cursor 2.5); a grandchild cannot. A refused dispatch: do the step inline and say so; a lead that cannot dispatch reports `needs-review`.
- Limits: none documented; suggest to the user, never write, a cap of `B-1` concurrent subagents.
- The command guard is `.cursor/hooks.json`: it asks before a merge, a push to the default branch or a protection change, and denies the rest. Do not look for a way around it; ask the user. The user trusts the workspace once.
