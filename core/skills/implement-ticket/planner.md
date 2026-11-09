# Planning details

Read `.ticketflow/custom/planner.md` first if it exists: it adds to and overrides this file. `SKILL.md` step 2 decides whether the planner is dispatched; this is how it is dispatched and how an earlier plan is used.

**Planned earlier** means the ticket's `Planning:` line links a committed plan file. Model or effort text, "plan ready" or a detailed description never counts. A linked plan is still re-verified: by the planner, or by you only when its files are unchanged since its sha (`git diff <sha>..origin/<default_branch> -- <files>` is empty).

**Planner:** dispatch the `ticket-planner` role with a compact brief (ticket number, decisions made, guides and files you know; no transcripts). Commit its output on the ticket branch (create the worktree first) as `<plans_dir>/YYYY-MM-DD-issue-<N>-<slug>-technical.md` (`docs: technical plan (#<N>)`), link it from the ticket and put the path in the `Planning:` line. Its Open decisions go to the user, never assumed; continue what is not blocked.
