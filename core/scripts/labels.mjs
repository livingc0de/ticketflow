#!/usr/bin/env node
/**
 * Brings the repo's labels to a list: creates the missing ones and never changes a label the repo already has, except the repo's own
 * `custom/labels.json` entries (colour, description and name case are updated to match that file). A TicketFlow label the repo has
 * with another look is listed as `differs:`; `--restyle` (the owner's choice) updates those too. The list is the file, an
 * `Area: <a>` label for each `areas` entry, an `Environment: <e>` label for each `environments` entry of the config, and `custom/labels.json` next to the config when it exists (same format). A name twice in that list is an error. Other labels are listed
 * with whether any issue or PR uses them and are deleted only with `--prune`, and only at zero use. During initialization,
 * `--prune-defaults` additionally offers only GitHub's unmodified, unused default labels for deletion.
 *
 * Usage: labels.mjs sync <labels.json> [--restyle] [--prune] [--prune-defaults] [--dry-run] [--config f]
 * Exit: 0 = in sync (or done), 1 = `--dry-run` found a create or update pending, 2 = usage, bad file, config or API error.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cli, main } from '../lib/cli.mjs'
import { GhError, api } from '../lib/gh.mjs'

const { positionals: [, file], cfg, configFile, values } = cli(import.meta.url, 'labels', 'sync <labels.json> [--restyle] [--prune] [--prune-defaults] [--dry-run] [--config f]', { restyle: { type: 'boolean' }, prune: { type: 'boolean' }, 'prune-defaults': { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, (p, v) => p[0] === 'sync' && p.length === 2 && !(v.prune === true && v['prune-defaults'] === true))
const R = `repos/${cfg.repo}`
const dry = values['dry-run'] === true
const lower = (s) => s.toLowerCase()

// shortcut: only the classic GitHub defaults with a known original tuple are candidates; revisit when GitHub publishes an authoritative unmodified baseline.
const ORIGINAL_DEFAULTS = new Map([
    ['bug', { name: 'bug', color: 'd73a4a', description: "Something isn't working" }],
    ['documentation', { name: 'documentation', color: '0075ca', description: 'Improvements or additions to documentation' }],
    ['duplicate', { name: 'duplicate', color: 'cfd3d7', description: 'This issue or pull request already exists' }],
    ['enhancement', { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' }],
    ['good first issue', { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' }],
    ['help wanted', { name: 'help wanted', color: '008672', description: 'Extra attention is needed' }],
    ['invalid', { name: 'invalid', color: 'e4e669', description: "This doesn't seem right" }],
    ['question', { name: 'question', color: 'd876e3', description: 'Further information is requested' }],
    ['wontfix', { name: 'wontfix', color: 'ffffff', description: 'This will not be worked on' }],
])

/** Validates the file before any call. Returns [{ name, color, description }] with lower-case colours. */
function load(path) {
    let list
    try { list = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { throw new GhError(`cannot read labels file ${path}: ${e.message}`) }
    if (!Array.isArray(list)) throw new GhError('labels file must be an array')
    const seen = new Set()
    return list.map((l, i) => {
        const at = `labels[${i}]`
        if (typeof l?.name !== 'string' || l.name.length < 1 || l.name.length > 50) throw new GhError(`${at}.name must be 1-50 characters`)
        if (typeof l.color !== 'string' || !/^[0-9a-fA-F]{6}$/.test(l.color)) throw new GhError(`${at}.color must be 6 hex digits`)
        const description = l.description ?? ''
        if (typeof description !== 'string' || description.length > 100) throw new GhError(`${at}.description must be at most 100 characters`)
        if (seen.has(lower(l.name))) throw new GhError(`${at}: duplicate name "${l.name}" (names compare ignoring case)`)
        seen.add(lower(l.name))
        return { name: l.name, color: lower(l.color), description }
    })
}

const AREA = { color: 'c5def5', description: 'Area of the product' }
const ENVIRONMENT = { color: 'c5def5', description: 'Deployment environment' }
/** The file, the Area and Environment labels, and custom/labels.json, validated together before any call. */
function wantedLabels() {
    const custom = join(dirname(configFile), 'custom', 'labels.json')
    // only the repo's own custom labels are kept in line; a core, Area or Environment label the repo already has is the repo's
    const all = [...load(file).map((l) => ({ ...l, createOnly: values.restyle !== true, core: true })), ...cfg.areas.map((a) => ({ name: `Area: ${a}`, ...AREA, createOnly: true })), ...cfg.environments.map((e) => ({ name: `Environment: ${e}`, ...ENVIRONMENT, createOnly: true })), ...(existsSync(custom) ? load(custom) : [])]
    const seen = new Set()
    for (const l of all) {
        if (seen.has(lower(l.name))) throw new Error(`duplicate label "${l.name}" (names compare ignoring case)`)
        seen.add(lower(l.name))
    }
    return all
}

function isOriginalDefault(label) {
    if (label?.default !== true || typeof label.name !== 'string' || typeof label.color !== 'string' || (label.description !== undefined && label.description !== null && typeof label.description !== 'string')) return false
    const original = ORIGINAL_DEFAULTS.get(lower(label.name))
    return original !== undefined && label.name === original.name && lower(label.color) === original.color && label.description === original.description
}

function issueLabelUse() {
    const issues = api(`${R}/issues?state=all&per_page=100`, { paginate: true })
    if (!Array.isArray(issues)) throw new GhError('issues API returned a non-array response')
    const used = new Set()
    for (const issue of issues) {
        if (issue === null || typeof issue !== 'object' || !Array.isArray(issue.labels)) throw new GhError('issues API returned a malformed issue or labels list')
        for (const label of issue.labels) {
            const name = typeof label === 'string' ? label : label?.name
            if (typeof name !== 'string') throw new GhError('issues API returned a malformed label')
            used.add(lower(name))
        }
    }
    return used
}

/** Returns a null usage set when discussion use cannot be ruled out; all other read failures stop before writes. */
function defaultLabelUse() {
    const repo = api(R)
    if (repo === null || typeof repo !== 'object' || Array.isArray(repo)) throw new GhError('repository API returned a malformed response')
    if (repo.has_discussions !== false) return { used: null, reason: repo.has_discussions === true ? 'repository discussions are enabled' : 'repository discussion status is unavailable' }
    return { used: issueLabelUse(), reason: null }
}

main('labels', () => {
    const wanted = wantedLabels()
    const live = api(`${R}/labels?per_page=100`, { paginate: true })
    if (!Array.isArray(live) || live.some((l) => l === null || typeof l !== 'object' || typeof l.name !== 'string')) throw new GhError('labels API returned a malformed response')
    const byName = new Map(live.map((l) => [lower(l.name), l]))
    const wantedNames = new Set(wanted.map((w) => lower(w.name)))
    const pruneDefaults = values['prune-defaults'] === true
    const defaultCandidates = pruneDefaults ? live.filter((l) => !wantedNames.has(lower(l.name)) && isOriginalDefault(l)) : []
    // Every read comes before the first write. The default path uses exact label arrays so commas are safe and pagination is complete.
    const defaultUse = defaultCandidates.length > 0 ? defaultLabelUse() : null
    if (defaultUse?.reason) console.log(`default prune skipped: ${defaultUse.reason}`)
    const extras = live.filter((l) => !wantedNames.has(lower(l.name))).map((l) => {
        const defaultCandidate = defaultCandidates.includes(l)
        const used = defaultCandidate
            ? defaultUse.used === null ? null : defaultUse.used.has(lower(l.name))
            : values.prune || !pruneDefaults
                // shortcut: the legacy filter is retained for --prune compatibility; revisit only with an explicit compatibility change.
                ? l.name.includes(',') || api(`${R}/issues?labels=${encodeURIComponent(l.name)}&state=all&per_page=1`).length > 0
                : null
        return { name: l.name, used, defaultCandidate }
    })
    const writes = []
    for (const w of wanted) {
        const have = byName.get(lower(w.name))
        if (!have) writes.push(['create', w.name, 'POST', `${R}/labels`, { name: w.name, color: w.color, description: w.description }])
        else if (have.name !== w.name || lower(have.color) !== w.color || (have.description ?? '') !== w.description) {
            if (w.createOnly) { if (w.core) console.log(`differs: ${have.name} (yours: #${lower(have.color)} "${have.description ?? ''}"; TicketFlow: ${w.name} #${w.color} "${w.description}"), kept`); continue }
            writes.push(['update', have.name === w.name ? w.name : `${have.name} -> ${w.name}`, 'PATCH', `${R}/labels/${encodeURIComponent(have.name)}`, { new_name: w.name, color: w.color, description: w.description }])
        }
    }
    for (const x of extras) {
        const state = x.used === null ? (x.defaultCandidate ? 'kept (usage unverified)' : 'kept (not an unmodified default)') : x.used ? 'in use' : 'unused'
        console.log(`extra: ${x.name} (${state})`)
        if (values.prune && !x.used) writes.push(['delete', x.name, 'DELETE', `${R}/labels/${encodeURIComponent(x.name)}`])
        if (pruneDefaults && x.defaultCandidate && x.used === false) writes.push(['delete', x.name, 'DELETE', `${R}/labels/${encodeURIComponent(x.name)}`])
    }
    const pending = writes.length
    for (const [verb, label, method, path, body] of writes) {
        console.log(`${dry ? 'would ' : ''}${verb} ${label}`)
        if (!dry) api(path, { method, body })
    }
    return dry && pending ? 1 : 0
})
