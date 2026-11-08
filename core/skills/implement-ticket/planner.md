# Planning details

`SKILL.md` step 2 decides whether the planner is dispatched; this is how, and how an earlier plan is used. Read `.ticketflow/custom/planner.md` only if the step 1 call listed it; it adds to and overrides this file.

**Planned earlier** means the ticket's `Planning:` line links a committed plan file. A linked plan is re-verified by you when its files are unchanged since its sha (`git diff <sha>..origin/<default_branch> -- <files>` is empty), otherwise as step 2 says; the planner is not dispatched again.

**Planner:** dispatch the `ticket-planner` role with a compact brief of facts: the ticket number, the decisions made, the config values it needs, the `custom/` files that exist, the files and guides you read with what you verified in them; no transcripts and no pasted documents (it reads the ticket once itself). Commit its output on the ticket branch (create the worktree first) as `<plans_dir>/YYYY-MM-DD-issue-<N>-<slug>-technical.md` (`docs: technical plan (#<N>)`), link it from the ticket and put the path in the `Planning:` line. Its Open decisions go to the user, never assumed; continue what is not blocked.
