# Technical plan: #2 Replace A Superseded Required Gate Context In protect.mjs

**Risk:** high (branch protection; the change can remove a required check). Planned because it touches the argument-order
invariant the guard relies on, the ruleset path and the classic-protection path, and the rollout has an ordering trap.

**Approach:** one optional flag, `--replace-context <old>`, accepted only last before `--config`
(`[--apply [--migrate-classic]] [--replace-context <old>]`), and in plan mode too (the rename PR merges through the old ruleset).
`desiredRuleset` gets a 4th parameter `drop` and filters `<old>` out of the merged required list (existing ruleset contexts, plus the
classic ones with `--migrate-classic`, plus the gate). The diff line shows the change in plan mode; the existing read-back fails on any
leftover `<old>`. Classic protection is never written: with `--migrate-classic`, `<old>` is dropped from the contexts it brings in and
the classic protection is deleted as today; without it, a classic protection that still requires `<old>` is refused before any write.

## Tasks

1. `core/lib/protect.mjs`: `desiredRuleset(existing, cfg, extraContexts = [], drop = null)`; in the `required_status_checks` fix filter
   `c.context !== drop` (by context name, so an app-bound copy is dropped too) and skip `drop` in the push loop. JSDoc.
2. `core/scripts/protect.mjs`:
   - option `'replace-context': { type: 'string' }`; usage and header line; one header sentence.
   - `valid`: no positionals, and `raw` equals one of `ORDER`, or `<order> --replace-context <old>` with a non-empty `<old>`, so
     `--apply` stays first (the guard prefix rules still match). Repeated, `=` form, empty or misplaced flag: exit 2, no calls.
   - `drop === cfg.gate.context`: exit 2 before any call.
   - after `classic` is read: `drop && !migrate && classic` requiring `<old>`: exit 1, zero writes, with the command to run.
   - `<old>` required neither by the ruleset nor the classic contexts: a warning ("not required; nothing to replace"), exit as usual.
   - pass `drop` to `desiredRuleset`; the read-back is unchanged.
3. Also fixed: `raw` strips `--config f` from any position, so `--config f --apply` passes the order check and dodges the prefix
   rules. Build `raw` from the arguments before `--config`, and require `--config` to be last.
4. Docs: `core/docs/CI-GATE.md` section "Renaming the gate context" (change `gate.context` on a branch and render; from that branch run
   the plan, then on the owner's yes `--apply --replace-context <old>`, `--migrate-classic` when classic requires it; merge with
   `merge.mjs`; other open PRs post the new name after updating; org-level rulesets are untouched; without the flag contexts are only
   added). `core/docs/UPGRADING.md`: a renamed `gate.context` needs this protection step before the sync PR merges. CHANGELOG.

## Tests (`tests/protect.test.mjs`)

- Plan shows `["ci/gate"] -> ["CI / Gate"]` with zero writes; `--apply` PUTs exactly `['CI / Gate']`, read-back exit 0; other contexts
  are kept (`['lint','ci/gate']` -> `['lint','CI / Gate']`); a context with spaces is accepted.
- A read-back that still requires `<old>` exits 1.
- Without the flag nothing is removed.
- Refusals with zero calls: the gate itself, flag before `--apply`, empty value, missing value, repeated flag, `=` form,
  `--config x --apply`; `--apply --migrate-classic --replace-context ci/gate` is accepted.
- Classic: requires `<old>` without migrate -> exit 1, zero writes; with migrate, PUT contexts drop `<old>`, DELETE after the read-back.
- Idempotency: `desiredRuleset` with `drop` on a synced body returns it unchanged; a not-required `<old>` warns and exits 0.
- "The result would require no context" cannot happen: the gate is always added and cannot be the dropped one (`gateName` forbids
  empty); the first test proves the result is exactly the gate.

## Callers checked

`desiredRuleset`: only `core/scripts/protect.mjs` and its tests. `protect.mjs` is run by `doctor.mjs` (no args, `--config` last) and
named in `skills/init/github.md`, `skills/init/existing-repo.md` and the `core/guard.json` prefix/ask rules (still match: `--apply`
stays first). No re-render needed.

## Open decision (default taken)

`skills/sync/SKILL.md` changes protection only after the merge, which deadlocks for a gate rename. Default: the skill text stays;
CI-GATE.md and UPGRADING.md document the before-merge step as an explicit owner action.

Verified against 4fd5993310f952a86068bf8f1c0fdb6335a00ef9 on 2026-10-27 (ticket-planner, Opus, high).
