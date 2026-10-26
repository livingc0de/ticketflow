# GitHub side

Every write comes after a shown dry run and a yes. Run the scripts of the installed runtime (`.ticketflow/scripts/`) from the repo root.

## Labels

1. `node .ticketflow/scripts/labels.mjs sync .ticketflow/templates/labels.json --dry-run` and show it. The list is ticketflow's labels, one `Area:` label per config area and `custom/labels.json` if present.
2. On a yes, the same command without `--dry-run`.
3. `--prune` removes unused labels the list does not name: only on a separate yes to the shown list.

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
2. On a yes, `node .ticketflow/scripts/protect.mjs --apply`. It prints the current ruleset first, so a rollback is a copy-paste.
3. `node .ticketflow/scripts/protect.mjs --apply --migrate-classic` (this exact order) only on a separate yes.
4. GitHub says the plan needs Pro, or you have no admin rights: offer to skip it and record a manual step in the report. Never use a bypass.
