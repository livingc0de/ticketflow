#!/usr/bin/env node
/**
 * Brings the repo's labels to a list: creates the missing ones and never changes a label the repo already has, except the repo's own
 * `custom/labels.json` entries (colour, description and name case are updated to match that file). A TicketFlow label the repo has
 * with another look is listed as `differs:`; `--restyle` (the owner's choice) updates those too. The list is the file, an
 * `Area: <a>` label for each `areas` entry of the config, and `custom/labels.json` next to the config when it exists (same format). A name twice in that list is an error. Other labels are listed
 * with whether any issue or PR uses them and are deleted only with `--prune`, and only at zero use.
 *
 * Usage: labels.mjs sync <labels.json> [--restyle] [--prune] [--dry-run] [--config f]
 * Exit: 0 = in sync (or done), 1 = `--dry-run` found a create or update pending, 2 = usage, bad file, config or API error.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cli, main } from '../lib/cli.mjs'
import { GhError, api } from '../lib/gh.mjs'

const { positionals: [, file], cfg, configFile, values } = cli(import.meta.url, 'labels', 'sync <labels.json> [--restyle] [--prune] [--dry-run] [--config f]', { restyle: { type: 'boolean' }, prune: { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, (p) => p[0] === 'sync' && p.length === 2)
const R = `repos/${cfg.repo}`
const dry = values['dry-run'] === true
const lower = (s) => s.toLowerCase()

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
/** The file, the Area labels and custom/labels.json, validated together before any call. */
function wantedLabels() {
    const custom = join(dirname(configFile), 'custom', 'labels.json')
    // only the repo's own custom labels are kept in line; a core or Area label the repo already has is the repo's
    const all = [...load(file).map((l) => ({ ...l, createOnly: values.restyle !== true, core: true })), ...cfg.areas.map((a) => ({ name: `Area: ${a}`, ...AREA, createOnly: true })), ...(existsSync(custom) ? load(custom) : [])]
    const seen = new Set()
    for (const l of all) {
        if (seen.has(lower(l.name))) throw new Error(`duplicate label "${l.name}" (names compare ignoring case)`)
        seen.add(lower(l.name))
    }
    return all
}

main('labels', () => {
    const wanted = wantedLabels()
    const live = api(`${R}/labels?per_page=100`, { paginate: true })
    const byName = new Map(live.map((l) => [lower(l.name), l]))
    const wantedNames = new Set(wanted.map((w) => lower(w.name)))
    // every read comes before the first write
    const extras = live.filter((l) => !wantedNames.has(lower(l.name))).map((l) => ({
        name: l.name,
        // shortcut: per_page=1 tells used from unused but not how many (a comma in a name would split the labels filter so it counts as used), count them if a prune needs the number.
        // Labels used only on discussions are not seen by the issues endpoint.
        used: l.name.includes(',') || api(`${R}/issues?labels=${encodeURIComponent(l.name)}&state=all&per_page=1`).length > 0,
    }))
    const writes = []
    for (const w of wanted) {
        const have = byName.get(lower(w.name))
        if (!have) writes.push(['create', w.name, 'POST', `${R}/labels`, { name: w.name, color: w.color, description: w.description }])
        else if (have.name !== w.name || lower(have.color) !== w.color || (have.description ?? '') !== w.description) {
            if (w.createOnly) { if (w.core) console.log(`differs: ${have.name} (yours: #${lower(have.color)} "${have.description ?? ''}"; TicketFlow: ${w.name} #${w.color} "${w.description}"), kept`); continue }
            writes.push(['update', have.name === w.name ? w.name : `${have.name} -> ${w.name}`, 'PATCH', `${R}/labels/${encodeURIComponent(have.name)}`, { new_name: w.name, color: w.color, description: w.description }])
        }
    }
    const pending = writes.length
    for (const x of extras) {
        console.log(`extra: ${x.name} (${x.used ? 'in use' : 'unused'})`)
        if (values.prune && !x.used) writes.push(['delete', x.name, 'DELETE', `${R}/labels/${encodeURIComponent(x.name)}`])
    }
    for (const [verb, label, method, path, body] of writes) {
        console.log(`${dry ? 'would ' : ''}${verb} ${label}`)
        if (!dry) api(path, { method, body })
    }
    return dry && pending ? 1 : 0
})
