#!/usr/bin/env node
/**
 * Brings the repo's labels to a list: creates the missing, updates colour, description and name case. Other labels are listed
 * with whether any issue or PR uses them and are deleted only with `--prune`, and only at zero use.
 *
 * Usage: labels.mjs sync <labels.json> [--prune] [--dry-run] [--config f]
 * Exit: 0 = in sync (or done), 1 = `--dry-run` found a create or update pending, 2 = usage, bad file, config or API error.
 */

import { readFileSync } from 'node:fs'
import { cli, main } from '../lib/cli.mjs'
import { GhError, api } from '../lib/gh.mjs'

const { values, positionals: [, file], cfg } = cli(import.meta.url, 'labels', 'sync <labels.json> [--prune] [--dry-run] [--config f]', { prune: { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, (p) => p[0] === 'sync' && p.length === 2)
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

main('labels', () => {
    const wanted = load(file)
    const live = api(`${R}/labels?per_page=100`, { paginate: true })
    const byName = new Map(live.map((l) => [lower(l.name), l]))
    const wantedNames = new Set(wanted.map((w) => lower(w.name)))
    // every read comes before the first write
    const extras = live.filter((l) => !wantedNames.has(lower(l.name))).map((l) => ({
        name: l.name,
        // ponytail: per_page=1 tells used from unused, not how many; a comma in a name would split the labels filter, so it counts as used.
        // Labels used only on discussions are not seen by the issues endpoint.
        used: l.name.includes(',') || api(`${R}/issues?labels=${encodeURIComponent(l.name)}&state=all&per_page=1`).length > 0,
    }))
    const writes = []
    for (const w of wanted) {
        const have = byName.get(lower(w.name))
        if (!have) writes.push(['create', w.name, 'POST', `${R}/labels`, w])
        else if (have.name !== w.name || lower(have.color) !== w.color || (have.description ?? '') !== w.description) {
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
