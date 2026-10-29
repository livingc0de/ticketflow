---
name: sync
description: Use when asked to update, upgrade or re-sync ticketflow in a repository that already has .ticketflow/manifest.json, or to move it to another ticketflow release.
---

# Update ticketflow in a repository

Rules: START.md's rules apply, and so do the rules of `skills/init/SKILL.md` (run from the repo root, `<TF>` written out in full, exit 2 means stop, no bypass). **No change reaches the default branch, and no GitHub setting (labels, Project, protection) changes, until the owner merges** (one exception: a gate rename, step 6).

## 0. Fetch and hand over

1. The installed version and the source URL are `version` and `source.url` in `.ticketflow/manifest.json`. The target version is the one the user named, else the latest release (`gh release view -R <owner>/<repo> --json tagName --jq .tagName`, from the URL). A target below the installed version: stop.
2. Show `source.url` and ask before cloning unless it is `https://github.com/livingc0de/ticketflow.git`. `git clone -q --depth 1 --branch <tag> <source.url> "$(mktemp -d)/ticketflow"`; `<TF>` is that path.
3. **Read `<TF>/skills/sync/SKILL.md` and continue there from section 1.** Part files are read from `<TF>/skills/init/`.

## 1. Branch

A manifest is required (else offer the `init` skill). Run `node <TF>/core/scripts/doctor.mjs --preflight`, then `git fetch origin` and `git checkout -b chore/ticketflow-<target version> origin/<default branch>`.

## 2. Read the upgrade notes

Read the sections of `<TF>/CHANGELOG.md` between the installed and the target version and summarize them. A note that needs a decision: ask. A file the notes say was removed: delete it on a yes.

## 3. Check for hand edits

With the **installed** runtime run `node .ticketflow/scripts/doctor.mjs --local`. For each `runtime`, `stubs` or `templates` hit show `git diff "$(git log -1 --format=%H -- .ticketflow/manifest.json)" -- <path>`:

- An empty diff on a template means only the config changed: continue.
- Otherwise offer (a) move the edit to `.ticketflow/custom/` or outside the managed block, then restore the file (recommended); or (b) keep the file with `--keep <path>` (not for stubs; runtime.mjs takes every kept path, render.mjs only the rendered files among them).
- Held files from the last run are asked about again.

## 4. Migrate the config

`node <TF>/core/lib/config.mjs migrate .ticketflow/config.json --write`. A question the notes added goes through `<TF>/skills/init/interview.md`. To enable a practice later, edit `practices` in the config here (for `live-verify` also set `live_verify_skill` to `live-verify`).

## 5. Update

1. `node <TF>/core/scripts/runtime.mjs <TF> . [--keep <path>]...` (pass every kept path)
2. `node .ticketflow/scripts/gen-stubs.mjs .ticketflow .`
3. `node .ticketflow/scripts/render.mjs .ticketflow/templates . [--keep <path>]...` (only the kept rendered files, such as `.github/workflows/ci.yml`)

Exit 1: resolve as `<TF>/skills/init/existing-repo.md` section Conflicts says, then run the step again. Exit 2: stop.

## 6. Check

Run `node .ticketflow/scripts/doctor.mjs`. Fix local failures. GitHub lines (labels, project, protection) go under "After merge" in the PR; never apply them now. One exception: a renamed `gate.context` follows `.ticketflow/docs/CI-GATE.md` ("Renaming the gate context"), whose protection step can come before the merge.

## 7. Open the pull request

Stage explicit paths, commit `chore: update ticketflow to <version>`, push, and open the PR from the PR template with the upgrade notes, the held files, "After merge", the manual steps (such as the Codex `/hooks` re-trust) and a note that the local fallback refuses (exit 3) until the checkout it runs from has pulled the merged default branch. Run `node .ticketflow/scripts/pr-wait.mjs <PR>` once, in the background: on exit 3 Actions refused the run and the owner lands it. Report, then review and merge it like any PR, only when the owner says so in chat (as in init section 5).

## 8. After the merge, on request

Clone the release again if `<TF>` is gone, run the "After merge" steps (they only add what the workflow needs; nothing the repo already has is changed) with the confirmations of `<TF>/skills/init/github.md`; do not use its initialization-only `--prune-defaults` flag. Then `node .ticketflow/scripts/doctor.mjs`. Finally remove `<TF>` and any `--propose` directory you created.
