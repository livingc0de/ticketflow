# GitHub side

Every write comes after a shown dry run and a yes. Run the scripts of the installed runtime (`.ticketflow/scripts/`) from the repo root.

## Labels

1. `node .ticketflow/scripts/labels.mjs sync .ticketflow/templates/labels.json --dry-run` and show it (a dry run exits 1 when changes are pending; that is not a failure, exit 2 is). The list is TicketFlow's labels, one `Area:` label per config area, one `Environment:` label per configured environment, and `custom/labels.json` if present. It only creates the missing ones; a label the repo already has is never changed, except the entries of `custom/labels.json`.
2. On a yes, the same command without `--dry-run`.
3. Labels the repo already has are kept. When the dry run lists `differs:` lines (a TicketFlow label the repo styled differently), show
   them and ask: keep the repo's look (default), or use TicketFlow's (`--restyle`, same command): one consistent look across repos,
   but it recolours and may rename labels people know.
4. `--prune` removes unused labels the list does not name: only on a separate yes to the shown list.

## Project

When the config has a `project`:

1. `node .ticketflow/scripts/project.mjs setup --dry-run` and show it. Several projects with the same title: ask which one.
2. On a yes, `node .ticketflow/scripts/project.mjs setup`. A created project's number goes into `.ticketflow/config.json`; validate the config again.
3. Exit 1 after applying: report what is left. Exit 2: stop.

## Deferred-checks issue

When the interview chose one: `gh issue create --title "Deferred live verification checklist" --body-file -` (a short description on stdin), then `node .ticketflow/scripts/project.mjs add <number>` and put the number in `deferred_checks_issue`.

## Protection

Only once the CI step that posts the gate is on the default branch (after the setup PR merged).

1. `node .ticketflow/scripts/protect.mjs` prints the plan, one line per difference. Show it and ask.
2. On a yes, `node .ticketflow/scripts/protect.mjs --apply`. It prints the current ruleset first, so a rollback is a copy-paste. It never
   changes the repo's merge methods, branch settings or an existing ruleset's bypass actors unless the owner opts in below.
   Its `protect: repo:` line shows the merge methods and branch settings; ask about each (keeping them is the default):
   - **Squash only** (`--squash-only`, added after `--apply`, also in plan mode to preview): one commit per ticket on the default branch,
     so history reads ticket by ticket and a revert undoes exactly one ticket; but per-commit history of a branch is lost, and teams
     that rebase or keep merge commits lose that option. Without it, `merge` uses squash whenever the repo allows it.
   - **Branch settings** (`--branch-settings`): delete a branch after its merge, and always suggest updating a branch that is behind;
     tidy and convenient with strict checks, but they are the repo's settings, so only on a yes.
3. When it warns about the repository-admin bypass of an existing ruleset (`always`, or no admin actor), explain and let the owner decide;
   keeping it is the default. `always`: an admin can push straight to the default branch, which is quick for emergencies, but nothing
   but the agents' rules stops an agent using an admin token from doing the same; "for pull requests only" keeps the emergency path
   (an admin merges a pull request past the checks) and blocks direct pushes. No admin actor: nobody, the owner included, can merge
   past a missing gate (strictest; an emergency needs the ruleset disabled first). To change it, the owner edits the ruleset's bypass
   list in the repo's Settings > Rules; record the choice in the report.
4. `node .ticketflow/scripts/protect.mjs --apply --migrate-classic` (this exact order) only on a separate yes.
5. GitHub says the plan needs Pro, or you have no admin rights: offer to skip it and record a manual step in the report. Never use a bypass.
