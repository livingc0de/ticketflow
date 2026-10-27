# Checks and report

1. Run `node .ticketflow/scripts/doctor.mjs`. Fix every `fail`, or record why it stays. A warning is listed in the report.
2. Report to the owner:
   - the version and commit (from `.ticketflow/manifest.json`);
   - the agents set up, the files written, the conflicts and how each was resolved, the held files;
   - the labels, the Project URL and the protection state;
   - anything unverified or skipped, and why.
3. Manual steps, as they apply (suggest them, never do them for the user):
   - Codex: trust the project and `.codex/hooks.json` through `/hooks` (again after any sync that changes it), and consider enabling `multi_agent` under `[features]` in the user config.
   - Claude Code: restart the session, so the new skills and agents load.
   - `timeout` missing: install coreutils.
   - Protection skipped: say why and how to do it later.
4. Remove the clone `<TF>` and any `--propose` directory you created. `local-verify` keeps its logs under `~/.cache/ticketflow-verify/`; leave them unless the user asks.
