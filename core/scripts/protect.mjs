#!/usr/bin/env node
/**
 * Protection of the default branch: compares the repo with the standard ruleset (plan mode) or brings it there.
 *
 * Usage: protect.mjs [--apply [--migrate-classic]] [--replace-context <old>] [--config f]   (this exact order, so one prefix rule can match `--apply`)
 *
 * Plan mode prints one line per difference (`path: current -> desired`). `--apply` first prints the current ruleset (a rollback is a
 * copy-paste), creates or updates the ruleset, then reads back: the difference must be empty and, for a ruleset created here,
 * `current_user_can_bypass` must be the expected one, otherwise exit 1. Repo settings (merge methods, branch deletion) are never changed. Existing protection is never weakened (see core/lib/protect.mjs).
 * Classic branch protection is kept, with a warning; `--migrate-classic` adds its required contexts to the ruleset and deletes it,
 * but only after the read-back passed, and not at all when it has a setting a ruleset here does not take over.
 * `--replace-context <old>` drops `<old>` from the required contexts in the same run (never automatically; never the gate itself); a
 * classic protection that still requires `<old>` is refused unless `--migrate-classic` moves it. See core/docs/CI-GATE.md.
 * Rulesets stack, so exactly one repo-level ruleset covering the default branch is updated in place; org-level rulesets are never touched.
 *
 * Exit: 0 = in sync / applied, 1 = drift (plan), a read-back mismatch, an empty repo, an unmappable classic setting or (--apply) a
 * classic protection that still requires the replaced context,
 * 2 = usage, config, missing admin right for --apply, or an API error (GitHub's message is shown, for example the plan upgrade notice).
 */

import { cli, main } from '../lib/cli.mjs'
import { GhError, api } from '../lib/gh.mjs'
import { CAN_BYPASS, classicBlockers, classicContexts, desiredRuleset, diff, relation } from '../lib/protect.mjs'

const ORDER = ['', '--apply', '--apply --migrate-classic']
// The arguments before --config, which must come last: so `--config f --apply` cannot slip past the order (and the prefix rules).
const argv = process.argv.slice(2)
const at = argv.findIndex((a) => a === '--config' || a.startsWith('--config='))
const configLast = at < 0 || (argv[at] === '--config' ? at === argv.length - 2 : at === argv.length - 1)
const raw = (at < 0 ? argv : argv.slice(0, at)).join(' ')
const ordered = (v) => configLast && (v['replace-context'] === undefined ? ORDER.includes(raw)
    : v['replace-context'] !== '' && ORDER.some((o) => raw === `${o} --replace-context ${v['replace-context']}`.trim()))
const { values, cfg } = cli(import.meta.url, 'protect', '[--apply [--migrate-classic]] [--replace-context <old>] [--config f]',
    { apply: { type: 'boolean' }, 'migrate-classic': { type: 'boolean' }, 'replace-context': { type: 'string' } }, (p, v) => p.length === 0 && ordered(v))
const drop = values['replace-context'] ?? null
if (drop === cfg.gate.context) {
    console.error(`protect: --replace-context "${drop}" is gate.context: nothing would replace it`)
    process.exit(2)
}
const R = `repos/${cfg.repo}`
const branch = cfg.default_branch
const notFound = (fn) => { try { return fn() } catch (e) { if (e instanceof GhError && e.http === 404) return null; throw e } }
const warn = (m) => console.error(`protect: warning: ${m}`)

main('protect', () => {
    const repo = api(R)
    if (repo.default_branch !== branch) throw new GhError(`${cfg.repo} has default branch ${repo.default_branch}, the config says ${branch}`)
    if (values.apply && repo.permissions?.admin !== true) throw new GhError('--apply needs admin rights on the repository')
    if (!notFound(() => api(`${R}/branches/${branch}`))) {
        console.error(`protect: ${cfg.repo} has no ${branch} yet: push the initial commit first`)
        return 1
    }
    const listed = api(`${R}/rulesets?per_page=100`)   // ponytail: no paging past 100 rulesets
    for (const r of listed.filter((x) => x.source_type && x.source_type !== 'Repository')) console.log(`org-level ruleset "${r.name}" (not touched)`)
    const touching = listed.filter((x) => !x.source_type || x.source_type === 'Repository').map((x) => api(`${R}/rulesets/${x.id}`)).map((x) => ({ x, how: relation(x, branch) })).filter((t) => t.how)
    const name = (x) => `"${x.name}" (id ${x.id})`
    const broad = touching.filter((t) => t.how === 'broad').map((t) => t.x)
    if (broad.length) {
        console.error(`protect: ${broad.map(name).join(', ')} also apply${broad.length > 1 ? '' : 'es'} to ${branch} together with other refs (a pattern, ~ALL or an exclude): adding the standard rules there would spread them. Split ${broad.length > 1 ? 'them' : 'it'} by hand so that one ruleset names only ${branch}, then run again`)
        return 2
    }
    if (touching.length > 1) {
        console.error(`protect: ${touching.length} rulesets cover ${branch}: ${touching.map((t) => name(t.x)).join(', ')}. Rulesets stack: merge them into one by hand, then run again`)
        return 2
    }
    const existing = touching[0]?.x ?? null
    const classic = notFound(() => api(`${R}/branches/${branch}/protection`))
    const migrate = values['migrate-classic'] === true
    const classicRequires = classic ? classicContexts(classic).some((c) => c.context === drop) : false
    if (drop && !migrate && classicRequires) {
        const m = `classic protection on ${branch} also requires "${drop}": add --migrate-classic (--apply --migrate-classic --replace-context ${drop}), or remove it there by hand`
        if (values.apply) { console.error(`protect: ${m}; nothing changed`); return 1 }
        warn(m)   // plan mode still shows the plan
    }
    const ruleRequires = (existing?.rules ?? []).some((r) => r.type === 'required_status_checks' && (r.parameters?.required_status_checks ?? []).some((c) => c.context === drop))
    if (drop && !ruleRequires && !classicRequires) warn(`"${drop}" is not required by a repo ruleset or classic protection; nothing to replace (an org-level ruleset is not changed here)`)
    if (migrate) {
        const blockers = classicBlockers(classic ?? {})
        if (blockers.length) {
            console.error(`protect: classic protection has settings a ruleset here does not take over (${blockers.join(', ')}): nothing changed`)
            return 1
        }
    }
    const { body, warnings } = desiredRuleset(existing, cfg, migrate && classic ? classicContexts(classic) : [], drop)
    for (const w of warnings) warn(w)
    if (classic?.enforce_admins?.enabled && migrate) warn('the classic protection applies to admins; the ruleset has the admin bypass, so admins can merge past the checks afterwards')
    if (classic && !migrate) warn(`classic branch protection on ${branch} stays and still applies; ${values.apply ? 'add' : 'run with'} --apply --migrate-classic to move it into the ruleset`)

    const current = { ruleset: existing }
    const desired = { ruleset: body }
    const lines = diff(current, desired)
    for (const l of lines) console.log(l)
    if (!values.apply) return lines.length ? 1 : 0

    if (existing) console.log(`current ruleset (rollback: PUT ${R}/rulesets/${existing.id} with this body):\n${JSON.stringify(existing, null, 2)}`)
    const saved = existing ? api(`${R}/rulesets/${existing.id}`, { method: 'PUT', body }) : api(`${R}/rulesets`, { method: 'POST', body })
    const back = api(`${R}/rulesets/${saved.id}`)
    const left = diff({ ruleset: back }, desired)
    const bypassWrong = !existing && back.current_user_can_bypass !== CAN_BYPASS   // only the actor this script added is checked
    if (left.length || bypassWrong) {
        for (const l of left) console.error(`protect: read-back differs: ${l}`)
        if (bypassWrong) console.error(`protect: read-back: current_user_can_bypass is ${back.current_user_can_bypass}, expected ${CAN_BYPASS}`)
        console.error('protect: the classic protection was not touched')
        return 1
    }
    if (migrate && classic) {
        console.log(`classic protection (rollback: PUT ${R}/branches/${branch}/protection, from this):\n${JSON.stringify(classic, null, 2)}`)
        api(`${R}/branches/${branch}/protection`, { method: 'DELETE' })
        console.log(`deleted classic branch protection on ${branch}`)
    }
    console.log(`${cfg.repo}: ${branch} is protected (ruleset id ${saved.id})`)
})
