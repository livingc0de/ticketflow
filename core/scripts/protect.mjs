#!/usr/bin/env node
/**
 * Protection of the default branch: compares the repo with the standard ruleset (plan mode) or brings it there.
 *
 * Usage: protect.mjs [--apply [--migrate-classic]] [--config f]      (this exact order, so one prefix rule can match `--apply`)
 *
 * Plan mode prints one line per difference (`path: current -> desired`). `--apply` first prints the current ruleset (a rollback is a
 * copy-paste), patches the repo settings, creates or updates the ruleset, then reads back: the difference must be empty and
 * `current_user_can_bypass` must be the expected one, otherwise exit 1. Existing protection is never weakened (see core/lib/protect.mjs).
 * Classic branch protection is kept, with a warning; `--migrate-classic` adds its required contexts to the ruleset and deletes it,
 * but only after the read-back passed, and not at all when it has a setting a ruleset here does not take over.
 * Rulesets stack, so exactly one repo-level ruleset covering the default branch is updated in place; org-level rulesets are never touched.
 *
 * Exit: 0 = in sync / applied, 1 = drift (plan), a read-back mismatch, an empty repo or an unmappable classic setting,
 * 2 = usage, config, missing admin right for --apply, or an API error (GitHub's message is shown, for example the plan upgrade notice).
 */

import { cli, main } from '../lib/cli.mjs'
import { GhError, api } from '../lib/gh.mjs'
import { CAN_BYPASS, classicBlockers, classicContexts, desiredRuleset, diff, relation, SETTINGS } from '../lib/protect.mjs'

const ORDER = ['', '--apply', '--apply --migrate-classic']
const raw = process.argv.slice(2).filter((a, i, all) => a !== '--config' && all[i - 1] !== '--config' && !a.startsWith('--config=')).join(' ')
const { values, cfg } = cli(import.meta.url, 'protect', '[--apply [--migrate-classic]] [--config f]', { apply: { type: 'boolean' }, 'migrate-classic': { type: 'boolean' } }, (p) => p.length === 0 && ORDER.includes(raw))
const R = `repos/${cfg.repo}`
const branch = cfg.default_branch
const notFound = (fn) => { try { return fn() } catch (e) { if (e instanceof GhError && e.http === 404) return null; throw e } }
const settingsOf = (repo) => Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, repo[k]]))
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
    if (migrate) {
        const blockers = classicBlockers(classic ?? {})
        if (blockers.length) {
            console.error(`protect: classic protection has settings a ruleset here does not take over (${blockers.join(', ')}): nothing changed`)
            return 1
        }
    }
    const { body, warnings } = desiredRuleset(existing, cfg, migrate && classic ? classicContexts(classic) : [])
    for (const w of warnings) warn(w)
    if (classic?.enforce_admins?.enabled && migrate) warn('the classic protection applies to admins; the ruleset has the admin bypass, so admins can merge past the checks afterwards')
    if (classic && !migrate) warn(`classic branch protection on ${branch} stays and still applies; ${values.apply ? 'add' : 'run with'} --apply --migrate-classic to move it into the ruleset`)

    const current = { settings: settingsOf(repo), ruleset: existing }
    const desired = { settings: SETTINGS, ruleset: body }
    const lines = diff(current, desired)
    for (const l of lines) console.log(l)
    if (!values.apply) return lines.length ? 1 : 0

    if (existing) console.log(`current ruleset (rollback: PUT ${R}/rulesets/${existing.id} with this body):\n${JSON.stringify(existing, null, 2)}`)
    if (Object.keys(SETTINGS).some((k) => repo[k] !== SETTINGS[k])) api(R, { method: 'PATCH', body: SETTINGS })
    const saved = existing ? api(`${R}/rulesets/${existing.id}`, { method: 'PUT', body }) : api(`${R}/rulesets`, { method: 'POST', body })
    const back = api(`${R}/rulesets/${saved.id}`)
    const left = diff({ settings: settingsOf(api(R)), ruleset: back }, desired)
    if (left.length || back.current_user_can_bypass !== CAN_BYPASS) {
        for (const l of left) console.error(`protect: read-back differs: ${l}`)
        if (back.current_user_can_bypass !== CAN_BYPASS) console.error(`protect: read-back: current_user_can_bypass is ${back.current_user_can_bypass}, expected ${CAN_BYPASS}`)
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
