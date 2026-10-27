# Checks and report

1. Run `node .ticketflow/scripts/doctor.mjs`. Fix every `fail`, or record why it stays. A warning is listed in the report.
2. Report to the owner:
   - the version and commit (from `.ticketflow/manifest.json`);
   - the agents set up, the files written, the conflicts and how each was resolved, the held files;
   - the labels, the Project URL and the protection state;
   - anything unverified or skipped, and why.
3. Manual steps, as they apply (suggest them, never do them for the user):
   - Codex: trust the project and `.codex/hooks.json` through `/hooks` (again after any sync that changes it), and for leads that dispatch their own planner and reviewer, suggest `agents.max_depth = 2` under `[agents]` in the user config.
   - Claude Code: restart the session, so the new skills and agents load. Cursor, Gemini CLI, OpenCode, Antigravity and Copilot: reload or restart them too.
   - Cursor: trust the workspace once (the guard hook runs after that). Gemini CLI: approve the project hook and the skills when asked, and suggest `tools.shell.inactivityTimeout` of 3000 or more in the user settings.
   - Copilot: trust the folder (CLI) and enable the Run Subagent tool and nested subagents (VS Code). Antigravity: check `/hooks` lists `ticketflow-guard`.
   - `timeout` missing: install coreutils.
   - Protection skipped: say why and how to do it later.
4. Remove the clone `<TF>` and any `--propose` directory you created. `local-verify` keeps its logs under `~/.cache/ticketflow-verify/`; leave them unless the user asks.
