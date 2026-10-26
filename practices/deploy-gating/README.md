---
name: deploy-gating
summary: Deploy only CI-green commits from a clean build, never from a working tree; schema before code; write down the rollback; check the build after each merge.
question: Does this repo deploy automatically?
detect: wrangler.*, fly.toml, vercel.json or netlify.toml; a Dockerfile together with deploy/; .github/workflows/*deploy*; or a set deploy_branch. Recommend yes on any of them.
---

# Practice: deploy-gating

Rules for repos where a merge reaches users without a human deploy step. No skill: the rules are short.

## What enabling it adds

One AGENTS line (`.ticketflow/practices/deploy-gating/README.md` is its source). No PR line.

## Variants

1. **A builder deploys the default branch** (a hosting platform watches it). The branch ruleset is the gate: only a commit that got through it starts a build.
2. **A deploy branch** (`deploy_branch` in the config) is moved only by green CI, with a plain push, never forced. The deploy host pulls that branch. Exclude it from the pull-request ruleset and give it its own: no deletion, no force push, updates limited to the CI identity and the maintainers who run a local fallback.

## Rules

- Never deploy from a working tree or with local env files. Deploy from a clean checkout in CI or on the builder.
- Add a bundle guard where the stack can ship env files by accident: refuse a build whose output carries any non-public env key or an env file.
- Deploy credentials live only in a protected environment or the builder's secret store, never in workflows or repo files.
- Schema before code: a change a deploy depends on reaches the shared database before the merge (database practice). The deploy does not wait for it.
- Write down the rollback (dashboard path or command, and who may run it) in `.ticketflow/custom/post-merge.md`.
- After a merge, check the build result before smoke testing (`.ticketflow/custom/post-merge.md`). A docs-only merge may start no build.
- Runtime secrets live in the host's secret store and are never synced from the repo.

## CI hint

A `check_run` workflow on the default branch that opens an assigned issue when the builder's check ends in anything but success. Pass event values through `env`, never interpolate them into the script. It needs CI minutes, so the post-merge check remains the backstop.

## Extend it

Describe your host, the guard, the rollback and the alert in `.ticketflow/custom/deploy-gating.md` and `.ticketflow/custom/post-merge.md`.

## Origin

Distilled from two production monorepos.
