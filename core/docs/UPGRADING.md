# Upgrading

TicketFlow never changes under your feet. Your repo keeps a pinned copy of one release, and moves to a newer one only when you ask
for it, through a pull request you review like any other.

TicketFlow changes your repo only when you ask: `init` once, then `sync` for each release you choose. The TicketFlow repo's tags are
the releases; `VERSION` is the version source.

## What is copied, and what is yours

`runtime.mjs` copies `core/` and the enabled `practices/<n>/` into `.ticketflow/`, except `config.json`, `manifest.json` and
`custom/`, which are the repo's. `gen-stubs` writes the agent stubs and `render` the managed blocks of the generated GitHub and agent
files ([CONFIG.md](CONFIG.md)). Your extensions are never touched ([EXTENDING.md](EXTENDING.md)).

## The manifest

`.ticketflow/manifest.json` records an install. `runtime.mjs` owns `version`, `source` (`url`, `tag`, `commit`), `files` (the sha256 of
every copied runtime file, CRLF read as LF) and `held`; `render.mjs` owns `claude_settings` (the `allow` and `ask` entries TicketFlow
added, so a later render can remove one it no longer wants). The file is deterministic: sorted keys and paths, no timestamps. Stubs and
rendered files are not hashed: `gen-stubs --check` and `render --check` cover them. In the TicketFlow repo itself (runtime in `core/`)
it holds only `manifest_version` and `claude_settings`.

## Held files

`runtime.mjs <source-clone> <target-repo> [--keep <path>]... [--dry-run]` writes nothing and exits 1 when a file the manifest lists
was edited, or a file in `.ticketflow/` is untracked, unless that file is byte-identical to the new one or named with `--keep`. A
kept file is recorded in `held`, never written or removed, and asked about again at every sync. `render --keep <path>` leaves one
rendered file alone. The better fix for a hand edit is to move it to `custom/` or outside the managed block, then restore the file.
Exit 2: a bad source, target, config or manifest. `--dry-run` prints `write|remove|keep|conflict <path>` per path and writes nothing.

## Config migration

`schema_version` is an integer; the release version lives in the manifest. A config loader never changes a file: an older config is an
error ("run sync"), a newer one is an error ("core older than config: sync"). Only `sync` migrates, with
`config.mjs migrate .ticketflow/config.json --write` (applies each step in order, writes only after the result validates).
`config.mjs validate <file>` checks without writing.

## The sync procedure

Run the `sync` skill (a plugin, or `START.md`). On a branch it: reads the CHANGELOG sections between the installed and the target
version; lists hand edits (`doctor --local` against the installed runtime) and offers to move or keep them; migrates the config; runs
`runtime`, `gen-stubs` and `render` from the new release; runs `doctor`; and opens a pull request. Nothing reaches the default branch,
and no GitHub setting (labels, Project, protection) changes, until the owner merges. `local-verify` refuses (exit 3) unless the runtime of the
checkout it runs from equals `origin/<default_branch>`, so after a sync merges, pull the default branch before using the fallback.

`doctor.mjs [--preflight | --local]` only reads. `--preflight` checks the tools (git, gh 2.48 or newer with the `repo`, `project` and
`workflow` scopes, node 18 or newer, `timeout`) and the repo; `--local` adds the config, runtime against the manifest, stubs,
templates, CI steps (a warning when `verify.command` runs twice), guard and gitignore with no GitHub call; the full run also dry-runs labels, the project and branch protection.
Exit 1 when a check failed, 2 on usage.

## Upgrade notes

Every release lists in its `CHANGELOG.md` what changed, and any step that needs a decision (a renamed default, a
removed file). `sync` reads and summarizes the sections you skip over.

A release or a config change that renames `gate.context` needs one protection step next to its merge (before it when CI runs the
job, after it when the local fallback does): `protect.mjs --apply --replace-context <old>` ([CI-GATE.md](CI-GATE.md#renaming-the-gate-context)).
