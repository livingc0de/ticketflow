# Action map: GitHub Copilot

The canonical skills and roles name actions. In Copilot (VS Code agent mode, Copilot CLI and the cloud agent), do them like this. `config.models.copilot ?? config.models.default` maps a model class to a supported model name; use `null` only when the agent should inherit the selected model.

Treat versionless values such as `astra`, `sol` and `luna` as model-family hints. Before passing a configured model to Copilot, keep a Copilot-native alias when the surface accepts it; otherwise resolve it to the current supported full model name. This applies to role frontmatter and helper or lead dispatches. Do not invent a version when the tool cannot resolve the hint; use the current session model instead.

| Action | How |
|---|---|
| Dispatch the `<role>` role | VS Code: `runSubagent` with the agent `<role>` (the repo's `.github/agents/<role>.agent.md`; the user enables the Run Subagent tool). Copilot CLI: the `task` tool. Cloud agent: its custom-agent tool |
| Dispatch a helper of a class | `runSubagent` or `task` with a task brief; the model is the agent's `model`, or the session's |
| Dispatch a fresh ticket lead | VS Code `runSubagent`, Copilot CLI `task`; brief it fully. The cloud agent: not possible (see Rules) |
| Run in the background and wait once | Run it in the foreground; on a timeout run the stateless script again |
| Ask the user | Ask one targeted question in the reply and wait. The cloud agent: ask in the pull request, then stop |
| Track tasks | The `todo` tool, one item per plan task |
| Load a skill | Skills in `.agents/skills/` load automatically; otherwise open the skill's `SKILL.md` named by the stub |
| Switch model or effort | You cannot change your own: say what the user should pick in the model picker, or hand the hard part to an agent with its own `model` and `reasoning-effort` |

## Rules

- Nesting: off unless the user sets `chat.subagents.allowInvocationsFromSubagents` (depth 5). A refused dispatch: do the step inline and say so; a lead reports `needs-review`.
- Limits: none documented.
- The cloud agent is never the orchestrator or a lead: it pushes only to a `copilot/*` branch, which the queue's `*/issue-<N>-*` match misses (the ticket would be dispatched again), and it cannot merge. It takes one ticket to a draft pull request, then stops.
- The command guard is a `PreToolUse` hook in `.github/hooks/ticketflow-guard.json` (the user trusts the folder): it asks before a merge, a push to the default branch or a protection change; the cloud agent cannot be asked, so it is denied. Do not look for a way around it.
