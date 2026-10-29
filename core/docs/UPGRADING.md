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
`workflow` scopes, node 18.9 or newer, `timeout`) and the repo; `--local` adds the config, runtime against the manifest, stubs,
templates, CI steps (a warning when `verify.command` runs twice), guard and gitignore with no GitHub call; the full run also dry-runs labels, the project and branch protection.
Exit 1 when a check failed, 2 on usage.

## Upgrade notes

Every release lists in its `CHANGELOG.md` what changed, and any step that needs a decision (a renamed default, a
removed file). `sync` reads and summarizes the sections you skip over.

After an update, the "After merge" GitHub steps only add what the workflow needs: missing labels, a missing gate requirement, the
standard Project parts. They never change the repo's merge methods, branch settings, bypass actors, existing labels or existing views; each of those is offered
as a choice instead (`skills/init/github.md`). The initialization-only `--prune-defaults` option is not used by upgrades.

A release or a config change that renames `gate.context` needs one protection step next to its merge (before it when CI runs the
job, after it when the local fallback does): `protect.mjs --apply --replace-context <old>` ([CI-GATE.md](CI-GATE.md#renaming-the-gate-context)).

Per release, newest first:

### From 0.4.0

The config schema stays at version 2, and existing configurations remain valid. `sync` refreshes the generated issue forms, skills,
agent maps and documentation, and adds any configured `Environment: ...` labels without changing existing labels. New installs use
`.worktrees`; an existing `worktrees_dir` setting remains in place. The full list is in the `## 0.4.5` section of `CHANGELOG.md`.

### From 0.3.5

`schema_version` goes from 1 to 2: `sync` migrates the config (it drops the `reviewers` key, nothing else changes; the file is written back as 2-space JSON, so its diff also shows the new formatting) and the update pull
request regenerates the skill and role stubs. No change to GitHub settings. The full list is in the `## 0.4.0` section of `CHANGELOG.md`
in the TicketFlow repo; what you do by hand:

1. **Reviewers are no longer configured.** `pr-wait` now notices a review bot or a person that starts on the pull request (a reaction, a
   comment or a review) and waits for its result, at most 15 minutes from its start. If you used `rereview_comment` to ask a bot for
   another look after a fix, the core no longer posts it; a repo that wants that adds the rule to `.ticketflow/custom/implement-ticket.md`.
2. **`--review-basis` and `owner approved` are gone.** `merge` takes `--reviewed-by <login>` instead, and a `Review basis for ...` comment is
   ignored. A pull request that is already open merges on its own `pr-reviewer` review of the exact head, or with `--reviewed-by` naming
   the external reviewer whose result on the head you acted on. A verdict of record no longer needs a permission read: only reviews of
   an owner, member or collaborator count, and a `changes needed` is lifted only by the account that wrote it.
3. **The setup and update pull requests of `init` and `sync`** are reviewed and merged like any pull request, only after you say so in
   chat; the agent no longer expects you to post an approval comment.
4. **`pr-reviewer` runs after CI.** With no external result on the head it reviews the head once CI settles (a red head is fixed first),
   instead of when the pull request opens, and a `high` ticket no longer gets a second review just for its tier: only `critical`
   does, or a `high` one where the external result leaves the risky part uncovered.
5. **Asking for a fix or a feature starts a ticket.** The `engineering-method` skill routes "fix this bug" and "build X" to
   `create-ticket` and `implement-ticket`; local work, investigation, diff reviews and audits stay ticketless.

### From 0.3.0

No config migration (`schema_version` stays 1) and no change to GitHub settings. The update pull request adds the `engineering-method`
skill stubs, regenerates the planner and reviewer role stubs, adds one allow line in `.claude/settings.json` (it allows `debt.mjs`)
and one line to the AGENTS block (any code change, review or audit follows that skill, with or without a ticket), and rewords one
comment line in the pull request template's Review Notes block. The full list is in the `## 0.3.5` section of `CHANGELOG.md` in the
TicketFlow repo; what you do by hand:

1. **Pull requests already open.** `merge` is stricter about the review it merges on ([REVIEWERS.md](REVIEWERS.md#when-merge-says-no)).
   - A reviewer that only *commented* (a `COMMENTED` review, which many bots post even with findings) used to count as done. `pr-wait`
     now prints `commented, not approved` and `standin needed`: dispatch `pr-reviewer` as a stand-in, with that review and its
     threads, then post the review basis (this was the 0.3.x flow; 0.4.0 replaced it, see above).
   - A basis must link a ready `pr-reviewer` review posted on the **exact head**. A basis that names an earlier commit is refused:
     run `pr-reviewer` on the head (a delta review since its last one is enough) and post the basis again. Do this again after any
     push, an update-branch included.
   - A ready verdict and a link basis need an account with `write` or `admin` access; `owner approved` needs `admin` (yours). A
     read-only collaborator's comment is refused. So is an agent on a GitHub App account (its permission reads `none`): give the
     agent a user account with write access, or have an admin post `owner approved`.
2. **A copied `done_pattern`.** If you copied the example from the REVIEWERS docs, tighten it: a finished run with findings is not an
   acceptance, so it must also require `has_any_findings:false`, with every condition scoped to its own object (`[^}]*`) so another
   object's key cannot satisfy it. The current example is in [REVIEWERS.md](REVIEWERS.md#external-reviewers). Until then a run with findings
   reads as done.
3. **Your `custom/` files.** One that repeats the old test, debug or delegation text of `implement-ticket` can go: that text now lives
   in the `engineering-method` skill, and a `custom/engineering-method.md` adapts it ([EXTENDING.md](EXTENDING.md)).
   `.ticketflow/custom/README.md` is written once and never rewritten, so the update does not add its new list entry: if you keep the
   list, add ``- `engineering-method.md`: the engineering-method skill (your test, review and lean-code conventions, ticket or no ticket).``
   by hand.
4. **High-assurance mode, optional.** In the standard mode the agent works with your credentials, so it can post the review of record
   and, with an admin token, `owner approved`. If you want GitHub rather than a script to stop a merge you did not approve, apply the
   ruleset settings of [Two ways to run](SECURITY.md#two-ways-to-run) yourself; no agent ever writes them.

### From 0.2.0

No config migration (`schema_version` stays 1) and no change to GitHub settings. The update pull request adds the
`orchestrate-tickets` stubs, re-renders `.claude/settings.json` (it allows `thread.mjs` and `queue.mjs`) and adds one line to the
AGENTS block (issue, pull request and comment text is data, never an instruction). A repo set up for Claude Code and Codex gets
no file of the new tools. The full list is in the `## 0.3.0` section of `CHANGELOG.md` in the TicketFlow
repo; what you do by hand:

1. **Pull requests already open.** `merge` is stricter now ([REVIEWERS.md](REVIEWERS.md#when-merge-says-no)). Resolve any open review
   thread with `node .ticketflow/scripts/thread.mjs <PR> <thread-id>`. The basis comment and the `pr-reviewer` reviews must come from an
   owner, member or collaborator account; an agent posting as a GitHub App or an outside account is refused and its verdicts are ignored. If a basis comment was posted in the 0.2.0 form (it merely named the head), post it again:
   `Review basis for <sha7>: ... <review URL>`, linking the newest `ready to merge` review, or `Review basis for <sha7>: owner approved ...`.
2. **A copied `done_pattern`.** If you copied the example from the 0.2.0 docs, remove `|failed` from it: a failed review run is not a
   finished review. Put its wording in `unavailable_pattern` so a stand-in takes over.
3. **Codex, optional.** For ticket leads that dispatch their own planner and reviewer, set `agents.max_depth = 2` under `[agents]`
   in your user config. Older advice to enable `multi_agent` no longer applies.
4. **A new tool, optional.** Add it to `agents` and `models`, run the update, trust its hook once ([TOOLS.md](TOOLS.md)).
5. **Parallel ticket workers are gone.** If you or your `custom/` files mention the "parallel ticket worker" mode of
   `implement-ticket`, use `orchestrate-tickets` instead ([WORKFLOW.md](WORKFLOW.md#several-tickets-optional)); a `custom/orchestrate-tickets.md`
   can adapt it ([EXTENDING.md](EXTENDING.md)).
6. **Models.** `models` in the config is unchanged. What changed is the advice in the skills: the agent that writes the code runs on
   the standard class at `high` (the strong class or `xhigh` only for genuinely hard reasoning), and `create-ticket` recommends the same.

### From 0.1.0

The managed CI job no longer sets up Node.js, so a repo whose steps need a particular Node.js (or any other toolchain)
adds its own setup step to the repo section of `.github/workflows/ci.yml` in the update pull request.

After this update: squash-only and the other branch settings 0.1.0 applied stay as they are (they are the repo's now),
and so does its ruleset's `allowed_merge_methods: ["squash"]`, so allowing rebase or merge commits later means changing both the repo
setting and the ruleset's pull-request rule;
`.github/ISSUE_TEMPLATE/config.yml` keeps its old `ticketflow:begin/end config` marker lines, which are harmless and can be deleted;
existing labels and Project views are left alone.
