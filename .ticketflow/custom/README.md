# Your extensions

This folder is yours: `sync` never touches it. A file here adds to and overrides the ticketflow file of the same name.

- `implement-ticket.md`: the implement-ticket skill (your build, test and live-check commands).
- `post-merge.md`: the steps after a merge (deploy, smoke checks, your handoff rules).
- `create-ticket.md`: the create-ticket skill (your label and tracker conventions).
- `engineering-method.md`: the engineering-method skill (your test, review and lean-code conventions, ticket or no ticket).
- `ticket-planner.md`: the ticket-planner role (the guides to read, your planning rules).
- `pr-reviewer.md`: the pr-reviewer role (your review lenses).
- `e2e-verifier.md`: the e2e-verifier role (your accounts and viewports).
- `<practice>.md`: one for each enabled practice (see `.ticketflow/practices/<practice>/README.md`); it adds to and overrides the practice.
- `labels.json`: labels your repo uses beyond ticketflow's (same format as `.ticketflow/templates/labels.json`); `labels sync` adds them.
