# Action map: any other agent

The canonical skills and roles name actions. Without sub-agents, do them like this.

| Action | How |
|---|---|
| Dispatch the `<role>` role | Do the role yourself, inline: read `.ticketflow/agents/<role>.md` and follow it, and say in your report that it ran inline. An inline `pr-reviewer` is never independent: ask the user before merging on it |
| Dispatch a helper | Do the work yourself, one piece at a time |
| Dispatch a fresh ticket lead | Not possible: run one ticket yourself, then stop and say so |
| Run in the background and wait once | Run it in the foreground: the ticketflow scripts are bounded by their own timeouts |
| Ask the user | Ask one targeted question and wait for the answer |
| Track tasks | A checklist in your reply, updated as you go |
| Load a skill | Open `.ticketflow/skills/<name>/SKILL.md` and follow it |
| Models | Use whatever model you run on; `config.models` does not apply |

## Rules

- Nesting: none. Limits: none to set.
- Never skip a gate because you cannot dispatch a role: do the step inline, say so, and let the user decide whether that is enough.
- Write the report the canonical file asks for, in the size it asks for.
