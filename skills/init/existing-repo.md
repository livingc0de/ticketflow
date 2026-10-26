# Existing repository

Work on the branch `chore/ticketflow-init`. Nothing is overwritten that ticketflow does not own: show the difference, then ask.

## Conflicts

**gen-stubs exits 1** (a skill or agent file with the same name exists and has no generated marker):

1. Move its repo-specific content to `.ticketflow/custom/<name>.md` (draft it, show it, write it on a yes). That file adds to and overrides the ticketflow skill or role.
2. `git rm` the old file, then run gen-stubs again.
3. A conflict on a real `.claude/rules/<name>.md` (a `domain-guides` rule): merge its content into `docs/agents/<name>.md` (with a `paths:` list), `git rm` the rule file, run gen-stubs again.
4. A conflict on a symlink (for example `.claude/rules/<name>.md` pointing at `docs/agents/<name>.md`): show it, delete the link on a yes (the guide itself stays), run gen-stubs again.

**render exits 1** (a file exists without ticketflow markers, or lacks a part ticketflow now writes):

1. Run render again with `--propose <tmp>`, where `<tmp>` is a new directory outside the repo.
2. For each conflict show `git diff --no-index <path> <tmp>/<path>`.
3. Offer: take the proposal (recommended); edit it together; or keep the file out with `--keep <path>`. Give `--keep <path>` to `render.mjs` and to `runtime.mjs`, which records it as held; held files are listed in the PR and asked about again at every sync.

**runtime.mjs exits 1** (a file in `.ticketflow/` that ticketflow did not write, or whose content changed): show `git diff --no-index <TF>/core/<path-without-.ticketflow/> <path>` (`<TF>/practices/...` for `.ticketflow/practices/...`). Offer: move the content to `custom/` and delete the file (recommended); or `--keep <path>`.

## Other cases

- A settings or hooks file that is not valid JSON: fix it with the owner first.
- `.github/workflows/ci.yml`: exactly one job posts `gate.context` and no job is named after it; the repo's own steps go in the repo section outside the managed blocks.
- `.claude/CLAUDE.md`: take the proposal that imports `AGENTS.md` through the block, and remove a stray `@AGENTS.md` line.
- Replaced copies: list the scripts, skills and agents that ticketflow now replaces and ask before deleting them in this PR.
- Never `--prune` labels without a yes to the shown list.
- An existing Project or ruleset is only topped up or updated in place. `--migrate-classic` only on a yes.
- Foreign `permissions.deny` rules are kept; render reports them. Mention them in the PR.

## Source repo

The target is the ticketflow repository itself (its runtime is `core/`): TF is `.`, skip `runtime.mjs`, run `node core/scripts/gen-stubs.mjs core .` and `node core/scripts/render.mjs core/templates .`, and never sync.
