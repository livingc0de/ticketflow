# New repository

- Do this in section 1, then go on with section 2 (interview) through section 4. No git: `git init -b main`; files that already exist must be committed before `doctor --preflight` passes (its `tree` check).
- No `origin`: offer `gh repo create <owner>/<name> --private --source . --remote origin` (ask for the owner and name). Rulesets on a private repo need a Pro or Team plan; say so.
- Unknown stack: ask for the verify command; do not guess one.
- Land (this replaces the pull request of section 5): commit on the default branch, then ask: "Push the initial commit straight to `<default branch>`? This is the only direct push; recommended yes." A guard prompt for that push counts as the confirmation. Do not open a pull request, there is no base to compare with.
- Then continue with `SKILL.md` section 6 (protection, once the gate step is on the default branch).
